// Bun supports importing HTML files; treat the import as opaque.
declare module '*.html' {
  const route: unknown;
  export default route;
}
