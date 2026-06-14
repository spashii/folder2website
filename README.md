# folder2website

Build a static site from a repo or markdown folder. Starts at `README.md`,
follows local markdown links, copies referenced assets, and writes plain files to
`site/`. No frontmatter. Bun-native.

```sh
folder2website <path-or-repo> [--out <dir>] [--token <T>] [--entry f.md ...]
                              [--base-url https://...] [--clone-dir <dir>]
                              [--port 4321] [--serve]

folder2website .                          # current repo -> ./site
folder2website owner/repo --token $GH_PAT # clone a (private) GitHub repo
folder2website . --base-url https://x.com # + sitemap, robots, llms.txt, per-page OG
folder2website owner/repo --clone-dir /tmp/repo # reuse this clone path if present
folder2website . --serve --port 4322       # live preview on a custom port
folder2website . --serve                  # live preview on :4321, reloads on save
folder2website -h                         # print usage
```

GitHub Pages recipe:
[`docs/deploy-with-github-pages.md`](docs/deploy-with-github-pages.md).

## Run it

Bun only, no npm publish needed.

Clone and run:

```sh
git clone https://github.com/spashii/folder2website
cd folder2website && bun install
bun index.ts /path/to/repo --out site     # or:  bun index.ts . --serve
```

Straight from GitHub, no clone (once pushed):

```sh
bunx github:spashii/folder2website#main owner/repo
bunx github:spashii/folder2website#main . --serve
```

Use `#main` when running from GitHub so Bun fetches the current branch instead
of reusing an older cached bare GitHub spec.

## What you get

### Structure

- Recursive pages: `README.md` becomes `index.html`; every linked local `.md`
  becomes its own page, links rewritten `.md` to `.html` (`README` to `index`).
- Assets (images, `LICENSE`, ...) copied at their original paths.
- `--entry` to seed extra/alternate pages (repeatable; default `README.md`).
- `--clone-dir` to choose the exact clone destination for a remote repo. If it
  already exists, folder2website uses it as-is, prints git status, and never
  fetches or pulls automatically.
- `--port` to choose the live preview port when using `--serve` (default `4321`).

### Reads like the repo (GitHub fidelity)

- Shiki syntax highlighting (dual light/dark), word-wrapped, with a language label.
- GitHub alerts (`> [!NOTE]` / `TIP` / `IMPORTANT` / `WARNING` / `CAUTION`).
- Footnotes, smart typography (curly quotes, dashes, ellipses).
- Anchored headings, collapsible table-of-contents, copy-code buttons.

### Markdown-native / agent-friendly

- A `.md` twin next to every page (`index.md`, `guide.md`, ...): clean source
  for humans and agents, with a "Copy as Markdown" button in the footer.
- `llms.txt` + `llms-full.txt` (with `--base-url`) indexing the twins.

### Polish

- Auto OG image (Satori), per-page with `--base-url`; bundled Lexend.
- Git footer: "Edit on GitHub" plus created/updated dates and authors, from git log.
- Theming from a standard web app `manifest.json` (name, icons, colors); extra
  palette and dark mode under a `readme_site` key. See
  [manifest.md](docs/manifest.md) for the full mapping.
- Hover link previews, internal link rewriting, live-reload dev server.

## Notes

- ponytail: a small script, not a framework. Want search, a sidebar, or
  versioned docs? reach for VitePress instead of growing this.
- `AGENTS.md` is instructions for agents *editing* a repo, not site content, so
  it isn't generated. If your README links to it, it renders like any page.
