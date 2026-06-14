# docsite

Point it at a repo — or any folder of markdown (a Notion/Obsidian export, a
skills dir) — and get a clean, self-contained, **markdown-native** static
site. It starts at `README.md`, follows links to local `.md` files
**recursively** (each becomes its own page), and copies every referenced asset
so nothing 404s. No config, no frontmatter — your README stays a normal README.
Small stack on Bun (`marked` + plugins, `satori`, `shiki`).

```sh
readme-site <path-or-repo> [--out <dir>] [--token <T>] [--entry f.md ...]
                           [--base-url https://...] [--serve]

readme-site .                            # current repo -> ./site
readme-site owner/repo --token $GH_PAT   # clone a (private) GitHub repo
readme-site . --base-url https://x.com   # + sitemap, robots, llms.txt, per-page OG
readme-site . --serve                    # live preview on :4321, reloads on save
```

## Run it

No npm publish required. Two ways:

**Clone and run** — works today, fully local:

```sh
git clone https://github.com/spashii/docsite
cd docsite && bun install
bun index.ts /path/to/repo --out site     # or:  bun index.ts . --serve
```

**Straight from GitHub, no clone** — once the repo is pushed, Bun runs it by git
ref (still no npm publish):

```sh
bunx github:spashii/docsite owner/repo
bunx github:spashii/docsite . --serve
```

`bunx` works because Bun executes the TypeScript entry directly; `npx` / `pnpm
dlx` run on Node and would first need a compiled JS build.

## What you get

### Structure

- Recursive pages — `README.md` → `index.html`; every linked local `.md` → a
  page, links rewritten `.md`→`.html` (`README`→`index`).
- Assets (images, `LICENSE`, …) copied at their original paths.
- `--entry` to seed extra/alternate pages (repeatable; default `README.md`).

### Reads like the repo (GitHub fidelity)

- Shiki syntax highlighting (dual light/dark).
- GitHub alerts (`> [!NOTE]` / `TIP` / `IMPORTANT` / `WARNING` / `CAUTION`).
- Footnotes, smart typography (curly quotes, en/em dashes, ellipses).
- Anchored headings + auto table-of-contents; copy-code buttons.

### Markdown-native / agent-friendly

- A `.md` twin next to every page (`index.md`, `guide.md`, …) — clean source
  for humans and agents, with a "Copy as Markdown" button in the footer.
- `llms.txt` + `llms-full.txt` (with `--base-url`) indexing the twins.

### Polish

- Auto OG image (Satori), per-page with `--base-url`; bundled Lexend.
- Git footer: "Edit on GitHub" + "Last updated", from the repo's remote + log.
- `theme.css` is the whole design — edit to taste.

## Notes

- ponytail: a small script, not a framework. Want search, a sidebar, or
  versioned docs? reach for VitePress instead of growing this.
- `AGENTS.md` is instructions for agents *editing* a repo, not site content — it
  isn't generated. If your README links to it, it's rendered like any page.
