// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axe from 'axe-core';
import {
  LinkedUrlsField,
  TargetUrlBanner,
  normalizeUrl,
  serializeUrlsToHtml,
  parseUrlsFromHtml,
  mergeUrlsIntoDescription,
  type LinkedUrlItem,
} from './LinkedUrlsField';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('URL Helper Functions', () => {
  it('normalizes various valid and scheme-less URLs correctly', () => {
    expect(normalizeUrl('https://example.com/checkout')).toBe('https://example.com/checkout');
    expect(normalizeUrl('http://localhost:3000/dashboard')).toBe('http://localhost:3000/dashboard');
    expect(normalizeUrl('staging.example.com')).toBe('https://staging.example.com/');
    expect(normalizeUrl('https://figma.com/file/123/Project?node-id=0')).toBe(
      'https://figma.com/file/123/Project?node-id=0',
    );
  });

  it('rejects unsafe schemes and invalid inputs', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('data:text/html,evil')).toBeNull();
    expect(normalizeUrl('vbscript:msgbox')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });

  it('serializes and parses URLs round-trip', () => {
    const urls: LinkedUrlItem[] = [
      { url: 'https://example.com/checkout', label: 'Affected page' },
      { url: 'https://staging.example.com/login' },
    ];

    const html = serializeUrlsToHtml(urls);
    expect(html).toContain('https://example.com/checkout');
    expect(html).toContain('(Affected page)');
    expect(html).toContain('https://staging.example.com/login');

    const parsed = parseUrlsFromHtml(html);
    expect(parsed.urls).toHaveLength(2);
    expect(parsed.urls[0]).toEqual({ url: 'https://example.com/checkout', label: 'Affected page' });
    expect(parsed.urls[1]).toEqual({ url: 'https://staging.example.com/login', label: undefined });
    expect(parsed.cleanHtml).toBe('');
  });

  it('parses URLs correctly even after server sanitization strips custom attributes', () => {
    // Simulated sanitized markup where div attributes were stripped
    const sanitizedHtml =
      '<p>Steps to reproduce</p><div><h4>Target &amp; Related URLs</h4><ul><li><a href="https://example.com/error" rel="noopener noreferrer nofollow" target="_blank">https://example.com/error</a> (Error URL)</li></ul></div>';

    const parsed = parseUrlsFromHtml(sanitizedHtml);
    expect(parsed.urls).toEqual([
      { url: 'https://example.com/error', label: 'Error URL' },
    ]);
    expect(parsed.cleanHtml).toBe('<p>Steps to reproduce</p>');
  });

  it('merges URLs into existing descriptions cleanly', () => {
    const originalDesc = '<p>The checkout button does not respond on click.</p>';
    const urls: LinkedUrlItem[] = [{ url: 'https://example.com/cart', label: 'Affected page' }];

    const merged = mergeUrlsIntoDescription(originalDesc, urls);
    expect(merged).toContain('<p>The checkout button does not respond on click.</p>');
    expect(merged).toContain('https://example.com/cart');
    expect(merged).toContain('(Affected page)');

    // Re-merging with updated URLs doesn't create duplicate blocks
    const updatedUrls: LinkedUrlItem[] = [
      { url: 'https://example.com/cart', label: 'Affected page' },
      { url: 'https://staging.example.com/cart', label: 'Staging' },
    ];
    const reMerged = mergeUrlsIntoDescription(merged, updatedUrls);
    const parsedAgain = parseUrlsFromHtml(reMerged);
    expect(parsedAgain.urls).toHaveLength(2);
    expect(parsedAgain.cleanHtml).toBe('<p>The checkout button does not respond on click.</p>');
  });
});

describe('LinkedUrlsField Component', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  function InteractiveWrapper({
    initialUrls = [],
    kind = 'issue',
    disabled = false,
  }: {
    initialUrls?: LinkedUrlItem[];
    kind?: 'issue' | 'bug' | 'feature' | 'brd' | 'daily' | 'version';
    disabled?: boolean;
  }) {
    const [urls, setUrls] = useState<LinkedUrlItem[]>(initialUrls);
    return <LinkedUrlsField urls={urls} onChange={setUrls} kind={kind} disabled={disabled} />;
  }

  function setInputValue(input: HTMLInputElement, value: string) {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('renders presets and handles adding and removing a URL', async () => {
    await act(async () => {
      root.render(<InteractiveWrapper kind="bug" />);
    });

    // Check bug-specific heading and chips
    expect(host.textContent).toContain('Affected URL / Error page');
    expect(host.textContent).toContain('Affected page');
    expect(host.textContent).toContain('Staging');
    expect(host.textContent).toContain('Production');

    const urlInput = host.querySelector<HTMLInputElement>('input[aria-label="URL to link"]')!;
    const labelInput = host.querySelector<HTMLInputElement>('input[aria-label="URL label"]')!;
    const addButton = host.querySelector<HTMLButtonElement>('button[aria-label="Add linked URL"]')!;

    // Select preset chip
    const chip = [...host.querySelectorAll<HTMLButtonElement>('.linked-url-preset-chip')].find(
      (c) => c.textContent === 'Staging',
    )!;
    await act(async () => {
      chip.click();
    });
    expect(labelInput.value).toBe('Staging');

    // Type URL and submit
    await act(async () => {
      setInputValue(urlInput, 'staging.example.com/test');
    });

    await act(async () => {
      addButton.click();
    });

    // Item should now be in the list
    expect(host.textContent).toContain('https://staging.example.com/test');
    expect(host.textContent).toContain('Staging');

    // Remove the item
    const removeBtn = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove URL https://staging.example.com/test"]',
    );
    expect(removeBtn).not.toBeNull();

    await act(async () => {
      removeBtn!.click();
    });

    expect(host.textContent).toContain('No URLs linked yet');
  });

  it('validates invalid and duplicate URLs', async () => {
    await act(async () => {
      root.render(
        <InteractiveWrapper
          kind="feature"
          initialUrls={[{ url: 'https://figma.com/file/123', label: 'Figma design' }]}
        />,
      );
    });

    const urlInput = host.querySelector<HTMLInputElement>('input[aria-label="URL to link"]')!;
    const addButton = host.querySelector<HTMLButtonElement>('button[aria-label="Add linked URL"]')!;

    // Try adding duplicate
    await act(async () => {
      setInputValue(urlInput, 'https://figma.com/file/123');
    });

    await act(async () => {
      addButton.click();
    });

    expect(host.textContent).toContain('This URL has already been added.');

    // Try adding invalid
    await act(async () => {
      setInputValue(urlInput, 'javascript:evil()');
    });

    await act(async () => {
      addButton.click();
    });

    expect(host.textContent).toContain('Please enter a valid web URL');
  });

  it('renders read-only mode when disabled', async () => {
    await act(async () => {
      root.render(
        <InteractiveWrapper
          kind="brd"
          disabled
          initialUrls={[{ url: 'https://spec.example.com', label: 'PRD document' }]}
        />,
      );
    });

    expect(host.querySelector('input[aria-label="URL to link"]')).toBeNull();
    expect(host.querySelector('.linked-url-remove')).toBeNull();
    expect(host.textContent).toContain('https://spec.example.com');
    expect(host.textContent).toContain('PRD document');
  });

  it('passes WCAG 2A/2AA accessibility audit', async () => {
    await act(async () => {
      root.render(
        <InteractiveWrapper
          kind="daily"
          initialUrls={[{ url: 'https://github.com/repo/pull/42', label: 'Pull request' }]}
        />,
      );
    });

    const results = await axe.run(host, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});

describe('TargetUrlBanner Component', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  it('renders target URLs with links and labels', async () => {
    const urls: LinkedUrlItem[] = [
      { url: 'https://example.com/checkout', label: 'Affected page' },
      { url: 'https://staging.example.com' },
    ];

    await act(async () => {
      root.render(<TargetUrlBanner urls={urls} />);
    });

    expect(host.textContent).toContain('Target URLs:');
    expect(host.textContent).toContain('https://example.com/checkout');
    expect(host.textContent).toContain('Affected page');
    expect(host.textContent).toContain('https://staging.example.com');

    const links = host.querySelectorAll('a.target-url-link');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('https://example.com/checkout');
    expect(links[0].getAttribute('target')).toBe('_blank');
  });

  it('returns null when URLs array is empty', async () => {
    await act(async () => {
      root.render(<TargetUrlBanner urls={[]} />);
    });

    expect(host.children).toHaveLength(0);
  });
});
