// Tiny POSIX-style path utilities for resolving EPUB-internal paths.
// All EPUB hrefs use forward slashes; we keep a simple normalize+resolve.

export function normalizePath(p: string): string {
  const parts = p.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

/** Resolve `href` against the directory containing `baseFile`. */
export function resolveAgainst(baseFile: string, href: string): string {
  const baseDir = baseFile.includes('/') ? baseFile.slice(0, baseFile.lastIndexOf('/')) : '';
  const combined = baseDir.length > 0 ? `${baseDir}/${href}` : href;
  return normalizePath(combined);
}

export function splitFragment(href: string): { path: string; fragment: string | null } {
  const hashAt = href.indexOf('#');
  if (hashAt < 0) return { path: href, fragment: null };
  return { path: href.slice(0, hashAt), fragment: href.slice(hashAt + 1) };
}
