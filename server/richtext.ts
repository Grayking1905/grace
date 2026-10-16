import sanitizeHtml from 'sanitize-html';

/** One allowlist for issue descriptions and documents, including editor node attributes. */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'h1',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      's',
      'u',
      'code',
      'pre',
      'blockquote',
      'a',
      'hr',
      'div',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      ul: [{ name: 'data-type', values: ['taskList'] }],
      li: [
        { name: 'data-type', values: ['taskItem'] },
        { name: 'data-checked', values: ['true', 'false'] },
      ],
      th: ['colspan', 'rowspan', 'colwidth'],
      td: ['colspan', 'rowspan', 'colwidth'],
      code: ['class'],
    },
    allowedClasses: { code: [/^language-[a-z0-9-]+$/i] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attributes) => ({
        tagName: 'a',
        attribs: {
          href: attributes.href || '',
          rel: 'noopener noreferrer nofollow',
          ...(attributes.target === '_blank' ? { target: '_blank' } : {}),
        },
      }),
    },
  });
}
