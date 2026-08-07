import { describe, expect, test } from 'bun:test';
import { sanitizeContent, urlScheme } from './render.ts';

function body(html: string): Element {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body;
}

describe('sanitizeContent', () => {
  test('drops active-content elements', () => {
    const root = body('<p>ok</p><iframe src="evil"></iframe><object></object><embed>');
    sanitizeContent(root);
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('object')).toBeNull();
    expect(root.querySelector('embed')).toBeNull();
    expect(root.querySelector('p')?.textContent).toBe('ok');
  });

  test('strips inline event handlers at every depth', () => {
    const root = body('<div onclick="x"><img src="a" onerror="y"><span onload="z">t</span></div>');
    sanitizeContent(root);
    expect(root.querySelector('div')?.hasAttribute('onclick')).toBe(false);
    expect(root.querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(root.querySelector('span')?.hasAttribute('onload')).toBe(false);
  });
});

describe('urlScheme', () => {
  test('reads real schemes and ignores whitespace browsers strip', () => {
    expect(urlScheme('https://example.com')).toBe('https');
    expect(urlScheme('  javascript:alert(1)')).toBe('javascript');
    expect(urlScheme('java\tscript:alert(1)')).toBe('javascript');
    expect(urlScheme('MAILTO:a@b.com')).toBe('mailto');
  });

  test('relative and fragment links have no scheme', () => {
    expect(urlScheme('ch2.xhtml#p3')).toBeNull();
    expect(urlScheme('#p3')).toBeNull();
    expect(urlScheme('../images/fig.png')).toBeNull();
  });
});
