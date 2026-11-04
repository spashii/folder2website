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
- `--base-url <url>`: production URL for canonical tags, sitemap, robots and
  OG. Also makes the links in `llms.txt` absolute.
- `--manifest <path>`: manifest path. Relative paths resolve from the target
  repo. Default: `manifest.json`.
- `--clone-dir <dir>`: exact clone destination for a remote repo. Existing
  clones are reused as-is.
- `--hide-generator-attribution`: omit the folder2website attribution from
  page footers.
- `--hide-footer-actions`: omit the edit and copy actions from page footers.
- `--hide-commit-info`: omit the Created and Updated lines, which come from the
  git log of each page.
- `--hide-related-pages`: omit the generated related-page list. Markdown links
  still populate the knowledge graph.
- `--check`: check the folder instead of building it. Exits 1 on errors. See
  [Check](#check).
- `--json`: with `--check`, print the findings as JSON.
- `--review`: show review markers. Off by default. See [Review](#review).
- `--mark-reviewed <file.md>`: record that a person reviewed this page, with
  or without `--review`. Repeatable. `all` marks every page.
- `--reviewer <name>`: the name stored with a mark. Default: `git config
  user.name`, then `$USER`.
- `--serve`: live preview.
- `--port <n>`: live preview port. Default: `4321`.

## Output

- `README.md` becomes `index.html`.
- Linked local `.md` files become `.html` pages.
- Extensionless local text links like `LICENSE` become pages.
- A markdown twin is written next to every page, such as `index.md` or
  `guide.md`. It opens with a short quote pointing an agent at `llms.txt`, and
  the page's review status when review is on. Copy as Markdown leaves that
  quote out.
- Referenced assets are copied.
- `llms.txt` in the [llmstxt.org](https://llmstxt.org) format: site title,
  summary, then the markdown twins listed per top-level folder. Translations
  go under `Optional`. Links are relative unless `--base-url` is set.
- `llms-full.txt`: every default-locale page inline, each under its title
  with a `Source:` line.
- Every page links its twin with `<link rel="alternate" type="text/markdown">`.
- With `--base-url`, the output includes `sitemap.xml` and `robots.txt`, and
  every page carries schema.org JSON-LD (`WebSite` for the home page, `WebPage`
  otherwise).

## Check

Every build prints what it found in the source; `--check` does only that,
writes nothing, and exits 1 when there are errors. Links are judged from the
rendered pages, and each finding names the markdown file, line and column.

```sh
bunx github:spashii/folder2website#main . --check
bunx github:spashii/folder2website#main . --check --json
```

```text
README.md:6:10  error  f2w/broken-link
  "giude.md" does not exist
  fix: did you mean "guide.md"?
```

Errors: `broken-link`, `broken-anchor` (only H2 and H3 headings get anchors),
`missing-asset`, `plantuml-failed`, `sidebar-entry`. Warnings: `outside-folder`,
`unlinked-file` (a markdown file no page links to; folders starting with `_`
or `.` are skipped), `single-h1`, `heading-hierarchy`, `code-block-lang`.

The JSON is `{ version, summary, diagnostics }`, plus `review` with
`--review`, so an agent can fix the findings and run it again.

## Review

For drafts an agent writes and a person reads. Off by default; `--review` turns
it on. `reviewed.json`, beside the home page, records each reviewed page with a
fingerprint of its text. A page with no entry, or whose text changed since,
reads as awaiting review:

- a line under its title, and for a changed page, what changed since the
  review, down to the words;
- a dot beside it in the sidebar;
- a list of every page awaiting review on the home page;
- a note in its markdown twin and in `llms.txt`, so agents know a person has
  not checked it.

Whitespace changes do not count. Nothing depends on git, so a plain folder works.

```sh
bunx github:spashii/folder2website#main . --review
bunx github:spashii/folder2website#main . --review --mark-reviewed access.md
bunx github:spashii/folder2website#main . --mark-reviewed all --reviewer Sameer
```

## Rendering

- Shiki syntax highlighting.
- Mermaid diagrams. Mermaid fences render in the browser in the site's own
  colours and font, follow light and dark, spill past the reading column like
  tables, and open full size on click. A fence that fails to parse shows its
  source and the error. The library ships only when a page uses one.
- GitHub alerts.
- PlantUML activity (including swimlanes) and state diagrams in fenced
  `plantuml` blocks. SVGs render locally at build time in light and dark site
  colours, share Mermaid's click-to-expand viewer, and scroll horizontally
  when wide. Renderer order: `FOLDER2WEBSITE_PLANTUML` (a shell command taking
  PlantUML on stdin and emitting SVG on stdout), `plantuml -tsvg -pipe` on
  PATH, then `docker run --rm -i plantuml/plantuml -tsvg -pipe`. No remote
  rendering service is used. Successful SVGs are cached by content hash in
  the system temp directory; renderer calls run one at a time. Failures show
  the source with an error note and print a warning without stopping the build.
- Footnotes.
- Heading anchors.
- Table of contents.
- Standalone text links rendered as action buttons. Links inside sentences
  stay inline.
- Tables spill past the reading column, centred, up to 1040px, and scroll
  only when wider than the viewport.
- Copy-code buttons.
- Image lightbox.
- Hover previews for internal pages.
- Git footer with an edit link, Markdown copy action, authors, and generator
  link.
- Manifest-based title, description, icon, colors, and optional extra CSS.
  `@import` rules in the extra CSS (web fonts) are hoisted to the top of the
  stylesheet so they take effect.

## Navigate & explore

- Breadcrumbs from the link graph, collapsing the middle when deep.
- Light/dark theme that follows the OS, with an alternate dark logo.
- Site search from a top-right icon, built on
  [MiniSearch](https://github.com/lucaong/minisearch). Results support keyboard
  navigation and links to matching sections. The output includes the index as
  `search-index.json`.
- Knowledge graph from a top-right icon, built on
  [d3-force](https://github.com/d3/d3-force). Pages keep one stable layout.
  Selecting a page highlights its links without rearranging the graph. The
  detail rail lists links and backlinks. Backlink emphasis is off by default.
  Graph colors and type use roles from the manifest theme.
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
