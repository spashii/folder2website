# folder2website

Build a static site from a repo or markdown folder.

- Starts at `README.md`.
- Follows local markdown links recursively.
- Copies referenced assets.
- Writes HTML and markdown twins to `site/`.
- No frontmatter.

## Run

```sh
bunx github:spashii/folder2website#main owner/repo
bunx github:spashii/folder2website#main . --serve
bunx github:spashii/folder2website#main . --serve --port 4322
bunx github:spashii/folder2website#main . --base-url https://example.com
bunx github:spashii/folder2website#main . --manifest docs/site.webmanifest
bunx github:spashii/folder2website#main . --hide-generator-attribution
bunx github:spashii/folder2website#main . --hide-footer-actions
```

Private repo:

```sh
GITHUB_TOKEN=github_pat_... bunx github:spashii/folder2website#main owner/repo
```

## Options

- `--out <dir>`: output directory. Default: `site`.
- `--entry <file>`: seed page. Repeatable. Default: `README.md`.
- `--base-url <url>`: production URL for canonical tags, sitemap, robots,
  OG, and `llms.txt`.
- `--manifest <path>`: manifest path. Relative paths resolve from the target
  repo. Default: `manifest.json`.
- `--clone-dir <dir>`: exact clone destination for a remote repo. Existing
  clones are reused as-is.
- `--hide-generator-attribution`: omit the folder2website attribution from
  page footers.
- `--hide-footer-actions`: omit the edit and copy actions from page footers.
- `--hide-related-pages`: omit the generated related-page list. Markdown links
  still populate the knowledge graph.
- `--serve`: live preview.
- `--port <n>`: live preview port. Default: `4321`.

## Output

- `README.md` becomes `index.html`.
- Linked local `.md` files become `.html` pages.
- Extensionless local text links like `LICENSE` become pages.
- A markdown twin is written next to every page, such as `index.md` or
  `guide.md`.
- Referenced assets are copied.
- With `--base-url`, the output includes `sitemap.xml`, `robots.txt`,
  `llms.txt`, and `llms-full.txt`.

## Rendering

- Shiki syntax highlighting.
- Mermaid diagrams. Mermaid fences render in the browser. The library ships
  only when a page uses one.
- GitHub alerts.
- Footnotes.
- Heading anchors.
- Table of contents.
- Standalone text links rendered as action buttons. Links inside sentences
  stay inline.
- Simple responsive tables with horizontal scrolling when needed.
- Copy-code buttons.
- Image lightbox.
- Hover previews for internal pages.
- Git footer with an edit link, Markdown copy action, authors, and generator
  link.
- Manifest-based title, description, icon, colors, and optional extra CSS.

## Navigate & explore

- Breadcrumbs from the link graph, collapsing the middle when deep.
- Light/dark theme that follows the OS, with an alternate dark logo.
- Site search from a top-right icon, built on
  [MiniSearch](https://github.com/lucaong/minisearch). Results support keyboard
  navigation and links to matching sections. The output includes the index as
  `search-index.json`.
- Knowledge graph from a top-right icon, built on
  [d3-force](https://github.com/d3/d3-force). The overview groups pages by
  section. Selecting a page shows one hop. Backlinks are hidden by default.
  Graph colors use the roles in the manifest theme.
- A grouped "Related pages" list on each page. It can open the graph focused
  on the current page. Use `--hide-related-pages` when the source already has
  its own related-links section.
- Optional language switcher. See [`docs/manifest.md`](docs/manifest.md).
- Optional giscus comments. See [`docs/manifest.md`](docs/manifest.md).

d3-force and MiniSearch are vendored under `vendor/` (see `vendor/README.md`) and
copied into the output, so a built site needs no third-party scripts at runtime.

## Deploy

GitHub Pages recipe:
[`docs/deploy-with-github-pages.md`](docs/deploy-with-github-pages.md).

Manifest mapping:
[`docs/manifest.md`](docs/manifest.md).
