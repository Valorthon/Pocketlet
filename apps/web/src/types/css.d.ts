// Next ships ambient declarations for CSS *modules* (`*.module.css` and the
// sass variants, in next/types/global.d.ts) but none for a plain global
// stylesheet. TypeScript 6 reports TS2882 for a side-effect import it cannot
// resolve to a module, where TS 5 accepted it silently, so `import
// './globals.css'` in src/app/layout.tsx needs one.
//
// The empty body is the accurate type, not a widening: that import is the only
// CSS import in the app and exists purely for its side effect, so nothing
// should be destructurable from it.
declare module '*.css' {}

// Re-stated deliberately, even though Next already declares it. TypeScript
// picks between wildcard ambient modules on prefix length alone, and `*.css`
// and `*.module.css` share the empty prefix — so whichever is declared first
// wins. Without this, the two declarations above and Next's would be ordered
// by however the files happen to be bound, and the first CSS module anyone
// adds could silently resolve to the export-less `*.css` shape instead. This
// matches Next's own declaration, so the order stops mattering.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
