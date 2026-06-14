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
```

Private repo:

```sh
GITHUB_TOKEN=github_pat_... bunx github:spashii/folder2website#main owner/repo
```

## Options

- `--out <dir>`: output directory. Default: `site`.
- `--entry <file>`: seed page. Repeatable. Default: `README.md`.
- `--base-url <url>`: production URL for canonical tags, sitemap, robots, OG, `llms.txt`.
- `--manifest <path>`: manifest path. Relative paths resolve from the target repo. Default: `manifest.json`.
- `--clone-dir <dir>`: exact clone destination for a remote repo. Existing clones are reused as-is.
- `--serve`: live preview.
- `--port <n>`: live preview port. Default: `4321`.

## Output

- `README.md` becomes `index.html`.
- Linked local `.md` files become `.html` pages.
- Extensionless local text links like `LICENSE` become pages.
- A markdown twin is written next to every page: `index.md`, `guide.md`, etc.
- Referenced assets are copied.
- With `--base-url`, `sitemap.xml`, `robots.txt`, `llms.txt`, and `llms-full.txt` are written.

## Rendering

- Shiki syntax highlighting.
- GitHub alerts.
- Footnotes.
- Heading anchors.
- Table of contents.
- Copy-code buttons.
- Image lightbox.
- Hover previews for internal pages.
- Git footer with edit link, markdown copy, created/updated authors, and generator link.
- Manifest-based title, description, icon, colors, and optional extra CSS.

## Deploy

GitHub Pages recipe:
[`docs/deploy-with-github-pages.md`](docs/deploy-with-github-pages.md).

Manifest mapping:
[`docs/manifest.md`](docs/manifest.md).
