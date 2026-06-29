# theming from manifest.json

Your `manifest.json` stays a normal web app manifest; folder2website reads a few
standard keys for theming and an optional `readme_site` key for the rest. No
manifest, no problem — sensible defaults apply.

Drop a `manifest.json` at the repo root, or pass `--manifest <path>`. Relative
paths resolve from the target repo. The selected file is parsed once at build
time, copied into the output as `manifest.json`, and linked from every page via
`<link rel="manifest">`. If it's missing or invalid JSON, it's ignored and the
built-in theme is used.

## standard keys

These are ordinary [web app manifest](https://developer.mozilla.org/docs/Web/Manifest)
keys, also understood by browsers and PWAs.

| key | what it controls |
| --- | --- |
| `name` (falls back to `short_name`) | site title / `<title>` |
| `description` | hero tagline on the index page, plus `<meta name="description">` and `<meta property="og:description">` |
| `icons[]` | the logo (and favicon). Prefers an entry whose `type` is `image/svg+xml` or whose `src` ends in `.svg`; otherwise the largest by `sizes` (leading integer wins) |
| `background_color` | CSS `--bg` (light), the OG image background, and `<meta name="theme-color">` (light) |
| `theme_color` | CSS `--accent` (light) and the OG image accent color |
| `display`, `start_url`, ... | copied through into the emitted `manifest.json` (installable), not used for theming |

## readme_site keys

`readme_site` is a folder2website-specific extension object. Browsers and PWAs
ignore it.

| key | what it controls |
| --- | --- |
| `fg` | `--fg` (light body text); also the OG image text color |
| `muted` | `--muted` (light secondary text) |
| `line` | `--line` (light borders / rules) |
| `font` | `--font` (font-family; auto-wrapped in quotes if the value has a space and isn't already quoted) |
| `width` | `--width` (content max-width) |
| `baseUrl` | fallback for the `--base-url` CLI flag when it's omitted (the flag wins if both are set) |
| `css` | path (relative to repo root) to an extra CSS file appended verbatim after the generated vars |
| `dark` | `{ bg, fg, muted, line, accent }`, emitted inside `@media (prefers-color-scheme: dark)`; `dark.bg` also drives the dark `<meta name="theme-color">` |
| `logo_dark` | alternate logo shown in dark mode (the `icons[]` logo is used in light mode) |
| `i18n` | translations: `{ defaultLocale, locales: [{ code, label }] }`. See [i18n](#i18n-translations) |
| `comments` | giscus comments per page (opt-in). See [comments](#comments-giscus) |

Only `background_color` and `theme_color` are read from the standard keys for
color; every other palette color (`fg`, `muted`, `line`, and the whole `dark`
block) lives under `readme_site`.

## i18n (translations)

`page.md` is the default locale; `page.<code>.md` next to it is a translation
(e.g. `guide.md` and `guide.nl-NL.md`). folder2website pairs them automatically,
renders a small language switcher in the top-right, and emits `<link rel="alternate" hreflang>` between the twins.

```json
"i18n": {
  "defaultLocale": "en-UK",
  "locales": [
    { "code": "en-UK", "label": "EN" },
    { "code": "nl-NL", "label": "NL" }
  ]
}
```

`code` is used for the file suffix and the `hreflang`; `label` is the switcher
button text. Pages with no twin simply show one language.

## comments (giscus)

Opt in to [giscus](https://giscus.app) comments at the foot of every page. A
brand-matched giscus theme (light + dark) is generated from your manifest
colours and written to `giscus-theme.css`.

```json
"comments": {
  "repo": "owner/repo",
  "repoId": "R_...",
  "category": "General",
  "categoryId": "DIC_...",
  "mapping": "pathname",
  "reactions": true,
  "inputPosition": "top",
  "lang": "en"
}
```

Get `repoId` / `categoryId` from the [giscus setup page](https://giscus.app).

When comments are enabled and the manifest carries theme colours, folder2website
writes a `giscus-theme.css` that `@import`s a shared base theme - structural
overrides like the left-aligned reactions, kept in the folder2website repo and
served over raw.githubusercontent - and layers your brand colours on top, so the
structural fixes are maintained in one place for every site. Overrides:

- `themeUrl` - absolute URL that replaces the generated theme entirely.
- `themeBaseUrl` - absolute URL of the base theme to `@import` (defaults to the
  one in the folder2website repo).

Note: giscus fetches the theme CSS cross-origin, so the host must send
`Access-Control-Allow-Origin` (the built-in `--serve` does). A secure giscus
iframe also cannot read a theme from `http://localhost` (browser local-network
policy) - the theme applies once the site is served over HTTPS.

## example

```json
{
  "name": "Quiet Reader",
  "short_name": "Reader",
  "description": "A calm, distraction-free place to read long things.",
  "display": "standalone",
  "start_url": "/",
  "background_color": "#faf7f0",
  "theme_color": "#b5613a",
  "icons": [
    { "src": "logo.svg", "type": "image/svg+xml" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "readme_site": {
    "fg": "#2b2622",
    "muted": "#7a7066",
    "line": "#e7dfd2",
    "font": "Iowan Old Style",
    "width": "44rem",
    "baseUrl": "https://reader.example.com",
    "css": "docs/extra.css",
    "dark": {
      "bg": "#1c1916",
      "fg": "#ece5da",
      "muted": "#9a9085",
      "line": "#332e28",
      "accent": "#e08a5c"
    }
  }
}
```

Here `name` titles the site, `description` becomes the hero tagline, `logo.svg`
is picked as the logo (svg wins over the larger PNG), `background_color` /
`theme_color` set the light `--bg` / `--accent`, and `readme_site` fills in the
rest of the light palette plus a full dark scheme.
