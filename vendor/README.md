# vendor

Third-party libraries bundled with folder2website and copied into the built site
(as `d3-force.js` and `minisearch.min.js`). Vendored so a built site loads no
scripts from a third-party origin, and so the graph/search work from `file://`.

| file | library | version | license |
| --- | --- | --- | --- |
| `d3-force.bundle.js` | [d3-force](https://github.com/d3/d3-force) (+ d3-dispatch, d3-quadtree, d3-timer) | v3 | ISC |
| `minisearch.min.js` | [MiniSearch](https://github.com/lucaong/minisearch) | v7 | MIT |

`d3-force.bundle.js` concatenates the d3 UMD builds it depends on; together they
expose `window.d3` (`forceSimulation`, `forceManyBody`, `forceLink`, …). MiniSearch
exposes `window.MiniSearch`. To update, replace a file with its upstream build of
the same global; no code changes are needed.
