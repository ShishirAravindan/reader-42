// In-archive path arithmetic. Every EPUB href is relative to the file that
// mentions it (container, OPF, nav, chapter), so resolution always needs the
// referencing file's path as the base.

/** Resolve `href` against the directory of `baseFile`, normalizing ./ and ../ . */
export function resolveAgainst(baseFile: string, href: string): string {
  const base = baseFile.split('/').slice(0, -1);
  const parts = href.split('/');
  const out = [...base];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

export function splitFragment(href: string): { path: string; fragment: string | null } {
  const at = href.indexOf('#');
  if (at < 0) return { path: href, fragment: null };
  return { path: href.slice(0, at), fragment: href.slice(at + 1) || null };
}
