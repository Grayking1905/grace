import { useState } from 'react';
import { Globe, Plus, X, ArrowUpRight, Link2, ExternalLink } from 'lucide-react';
import { Badge, Button } from './ui';

export interface LinkedUrlItem {
  url: string;
  label?: string;
}

const PRESETS: Record<string, string[]> = {
  bug: ['Affected page', 'Error URL', 'Staging', 'Production', 'Console logs'],
  brd: ['Prototype / Figma', 'PRD document', 'Live system', 'Competitor reference'],
  version: ['Staging deployment', 'Production release', 'Changelog', 'Checklist'],
  daily: ['Target page', 'Pull request', 'Issue tracker', 'Documentation'],
  feature: ['Figma design', 'Target page', 'API spec', 'PRD link'],
  issue: ['Target page', 'Design link', 'Reference URL', 'Documentation'],
};

const HEADINGS: Record<string, { title: string; subtitle: string; placeholder: string }> = {
  bug: {
    title: 'Affected URL / Error page',
    subtitle: 'Pinpoint the exact page or environment where this problem occurs',
    placeholder: 'https://example.com/checkout or staging.example.com',
  },
  brd: {
    title: 'Specification & reference URLs',
    subtitle: 'Link to prototypes, design specs, user research or live applications',
    placeholder: 'https://figma.com/file/... or https://docs.example.com/...',
  },
  version: {
    title: 'Release & deployment URLs',
    subtitle: 'Specify staging, production, or release checklist destinations',
    placeholder: 'https://staging.example.com or https://release-notes.example.com',
  },
  daily: {
    title: 'Target URL / Context',
    subtitle: 'Link to the active task, page, repository or ticket',
    placeholder: 'https://github.com/... or https://app.example.com/...',
  },
  feature: {
    title: 'Target & design URLs',
    subtitle: 'Link to designs, acceptance criteria, or target application page',
    placeholder: 'https://figma.com/... or https://example.com/feature',
  },
  issue: {
    title: 'Target & related URLs',
    subtitle: 'Attach web URLs to identify which page or environment this relates to',
    placeholder: 'https://example.com/page or localhost:3000/...',
  },
};

export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function serializeUrlsToHtml(urls: LinkedUrlItem[]): string {
  if (!urls.length) return '';
  const items = urls
    .map((u) => {
      const cleanUrl = u.url.replaceAll('"', '&quot;');
      const labelText = u.label ? ` (${u.label})` : '';
      return `<li><a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${labelText}</li>`;
    })
    .join('');
  return `<div class="linked-urls-block" data-linked-urls="true"><h4>Target &amp; Related URLs</h4><ul>${items}</ul></div>`;
}

export function parseUrlsFromHtml(html: string): { urls: LinkedUrlItem[]; cleanHtml: string } {
  if (!html) return { urls: [], cleanHtml: '' };

  const blockRegex = /(?:<div[^>]*>)?\s*<h4>Target (?:&amp;|&) Related URLs<\/h4>\s*<ul>([\s\S]*?)<\/ul>\s*(?:<\/div>)?/i;
  const match = blockRegex.exec(html);

  if (!match) {
    return { urls: [], cleanHtml: html };
  }

  const cleanHtml = html.replace(blockRegex, '').trim();
  const listHtml = match[1];
  const urls: LinkedUrlItem[] = [];

  const liRegex = /<li><a href="([^"]+)"[^>]*>[\s\S]*?<\/a>(?:\s*(?:<span[^>]*>)?\(([^)]+)\)(?:<\/span>)?)?<\/li>/gi;
  let liMatch: RegExpExecArray | null;

  while ((liMatch = liRegex.exec(listHtml)) !== null) {
    const rawUrl = liMatch[1];
    const rawLabel = liMatch[2];
    if (rawUrl) {
      urls.push({
        url: rawUrl,
        label: rawLabel ? rawLabel.trim() : undefined,
      });
    }
  }

  return { urls, cleanHtml };
}

export function mergeUrlsIntoDescription(description: string, urls: LinkedUrlItem[]): string {
  const { cleanHtml } = parseUrlsFromHtml(description);
  const serialized = serializeUrlsToHtml(urls);
  if (!serialized) return cleanHtml;
  return cleanHtml ? `${cleanHtml}\n${serialized}` : serialized;
}

export function LinkedUrlsField({
  urls,
  onChange,
  kind = 'issue',
  disabled = false,
}: {
  urls: LinkedUrlItem[];
  onChange: (urls: LinkedUrlItem[]) => void;
  kind?: 'issue' | 'bug' | 'feature' | 'brd' | 'daily' | 'version';
  disabled?: boolean;
}) {
  const [inputUrl, setInputUrl] = useState('');
  const [inputLabel, setInputLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const meta = HEADINGS[kind] || HEADINGS.issue;
  const presets = PRESETS[kind] || PRESETS.issue;

  const handleAdd = () => {
    setError(null);
    const normalized = normalizeUrl(inputUrl);
    if (!normalized) {
      setError('Please enter a valid web URL (e.g. https://example.com/page)');
      return;
    }
    if (urls.some((u) => u.url.toLowerCase() === normalized.toLowerCase())) {
      setError('This URL has already been added.');
      return;
    }
    onChange([
      ...urls,
      {
        url: normalized,
        label: inputLabel.trim() || presets[0] || undefined,
      },
    ]);
    setInputUrl('');
    setInputLabel('');
  };

  const handleRemove = (index: number) => {
    onChange(urls.filter((_, i) => i !== index));
  };

  return (
    <div className="linked-urls-field" aria-label="Target and linked URLs">
      <div className="linked-urls-header">
        <div className="linked-urls-title">
          <Globe size={16} className="linked-urls-icon" />
          <div>
            <strong>{meta.title}</strong>
            <p>{meta.subtitle}</p>
          </div>
        </div>
        {urls.length > 0 && <Badge>{urls.length} linked</Badge>}
      </div>

      {!disabled && (
        <div className="linked-urls-inputs">
          <div className="linked-urls-input-row">
            <input
              type="text"
              className="linked-url-main-input"
              value={inputUrl}
              onChange={(e) => {
                setInputUrl(e.target.value);
                if (error) setError(null);
              }}
              placeholder={meta.placeholder}
              aria-label="URL to link"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            <input
              type="text"
              className="linked-url-label-input"
              value={inputLabel}
              onChange={(e) => setInputLabel(e.target.value)}
              placeholder="Label (optional)"
              aria-label="URL label"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={handleAdd}
              disabled={!inputUrl.trim()}
              aria-label="Add linked URL"
            >
              <Plus size={14} />
              Add URL
            </Button>
          </div>

          <div className="linked-urls-presets">
            <span className="linked-urls-presets-label">Quick labels:</span>
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`linked-url-preset-chip ${inputLabel === preset ? 'active' : ''}`}
                onClick={() => setInputLabel(preset)}
              >
                {preset}
              </button>
            ))}
          </div>

          {error && (
            <div className="linked-url-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}

      {urls.length > 0 ? (
        <div className="linked-urls-list">
          {urls.map((item, index) => (
            <div className="linked-url-item" key={`${item.url}-${index}`}>
              <div className="linked-url-info">
                <Link2 size={14} className="linked-url-icon" />
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="linked-url-anchor"
                  title={`Open ${item.url}`}
                >
                  <span className="linked-url-text">{item.url}</span>
                  <ExternalLink size={12} />
                </a>
                {item.label && <Badge>{item.label}</Badge>}
              </div>
              {!disabled && (
                <button
                  type="button"
                  className="linked-url-remove"
                  onClick={() => handleRemove(index)}
                  aria-label={`Remove URL ${item.url}`}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="linked-urls-empty">
          <span>No URLs linked yet. Add a URL to easily pinpoint where this issue occurred.</span>
        </div>
      )}
    </div>
  );
}

export function TargetUrlBanner({
  urls,
  onCopy,
}: {
  urls: LinkedUrlItem[];
  onCopy?: (text: string) => void;
}) {
  if (!urls.length) return null;

  return (
    <div className="target-url-banner" aria-label="Identified target URLs">
      <div className="target-url-banner-title">
        <Globe size={15} />
        <span>Target URL{urls.length > 1 ? 's' : ''}:</span>
      </div>
      <div className="target-url-banner-links">
        {urls.map((item, idx) => (
          <div className="target-url-banner-item" key={`${item.url}-${idx}`}>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="target-url-link"
              title={item.url}
            >
              <span>{item.url}</span>
              <ArrowUpRight size={13} />
            </a>
            {item.label && <Badge>{item.label}</Badge>}
          </div>
        ))}
      </div>
    </div>
  );
}
