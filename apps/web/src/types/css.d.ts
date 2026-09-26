// Next.js compiles stylesheets through its own loader and ships no ambient
// declaration for them. TypeScript 6 reports TS2882 for a side-effect import it
// cannot resolve to a module (TS 5 accepted it silently), so declare the shape
// the app actually relies on: a module imported purely for its side effect,
// exporting nothing.
declare module '*.css' {}
