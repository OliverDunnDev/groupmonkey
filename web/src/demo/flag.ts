/**
 * True in the static GitHub Pages demo build (`npm run build:demo`, Vite mode "demo"). In that build the whole API runs
 * in the browser (src/demo/server.ts) instead of calling the .NET API.
 *
 * `__DEMO__` is substituted by Vite's `define` (vite.config.ts) with a literal true/false. api/client.ts tests `__DEMO__`
 * directly so Rollup sees `if (false)` in normal builds and drops the demo chunk entirely; UI code can use `isDemo`.
 */
export const isDemo: boolean = __DEMO__
