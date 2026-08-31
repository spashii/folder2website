#!/usr/bin/env bun
// folder2website - render a repo's README (and every .md it links to), or any
// folder of markdown (a Notion/Obsidian export, a skills dir), as a clean,
// self-contained static site. Bun-native. No config, no frontmatter.
//
//   folder2website <path-or-repo> [--out <dir>] [--token <T>] [--entry f.md ...]
//                                 [--base-url https://...] [--manifest <path>] [--clone-dir <dir>]
//                                 [--hide-generator-attribution] [--hide-footer-actions] [--hide-related-pages]
//                                 [--port 4321] [--serve]
//
// ponytail: a small script, not a framework. Want search/sidebar/versioning?
// reach for VitePress instead of growing this.
import { $ } from "bun";
import { marked } from "marked";
import markedShiki from "marked-shiki";
import markedAlert from "marked-alert";
import markedFootnote from "marked-footnote";
import { markedSmartypants } from "marked-smartypants";
import { codeToHtml } from "shiki";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, relative, posix, extname } from "node:path";
import { tmpdir } from "node:os";
import { makeOgPng } from "./og.ts";

const argv = process.argv.slice(2);
const usage = "usage: folder2website <path-or-repo> [--out <dir>] [--token <T>] [--entry f.md ...] [--base-url <url>] [--manifest <path>] [--clone-dir <dir>] [--hide-generator-attribution] [--hide-footer-actions] [--hide-related-pages] [--port <n>] [--serve]";
if (argv.includes("-h") || argv.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const flags = new Set(["--out", "--token", "--entry", "--base-url", "--manifest", "--clone-dir", "--port"]);
const target = argv.filter((a, i) => !a.startsWith("-") && !flags.has(argv[i - 1]))[0];
if (!target) {
  console.error(usage);
  process.exit(1);
}
const token = flag("--token") ?? process.env.GITHUB_TOKEN;
const outDir = resolve(flag("--out") ?? "site");
const baseUrl = flag("--base-url")?.replace(/\/$/, "");
const manifestArg = flag("--manifest");
const clonePath = flag("--clone-dir") ? resolve(flag("--clone-dir")) : null;
const showGeneratorAttribution = !argv.includes("--hide-generator-attribution");
const showFooterActions = !argv.includes("--hide-footer-actions");
const showRelatedPages = !argv.includes("--hide-related-pages");
const port = Number(flag("--port") ?? 4321);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("--port must be an integer from 1 to 65535");
  process.exit(1);
}
const seeds = argv.reduce((a, x, i) => (x === "--entry" && argv[i + 1] ? [...a, argv[i + 1]] : a), []);

const here = import.meta.dir;
const themePath = join(here, "theme.css");
const font = (f) => join(here, "fonts", f);

const readText = (p) => Bun.file(p).text();
const write = (p, data) => Bun.write(p, data); // Bun.write creates parent dirs
const copy = (src, dest) => Bun.write(dest, Bun.file(src));
const gitOut = async (args) => { try { return (await $`git ${args}`.nothrow().quiet().text()).trim(); } catch { return ""; } };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const ogTagline = (s) => { const f = s.split(/(?<=[.!?])\s/)[0]; return f.length <= 140 ? f : f.slice(0, 137).replace(/\s+\S*$/, "") + "…"; };
// the page's first real paragraph, markdown stripped - a fuller description for the graph panel
const firstPara = (src) => {
  const b = (src || "").split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !/^[#>|]/.test(x) && !x.startsWith("![") && !x.startsWith("```") && !x.startsWith("- ") && !x.startsWith("* ") && !standaloneMarkdownHref(x));
  if (!b) return "";
  const t = b.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  return t.length > 260 ? t.slice(0, 257).replace(/\s+\S*$/, "") + "…" : t;
};
// --- search index helpers ---
function docSection(id) {
  if (id === "index.html" || id === "map.html") return "Home";
  const parts = id.split("/").slice(0, -1);
  if (!parts.length) return "";
  return parts[parts.length - 1]
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(And|Or|Of|The)\b/g, (word) => word.toLowerCase())
    .replace(/\bSaas\b/g, "SaaS")
    .replace(/\bApi\b/g, "API")
    .replace(/\bSso\b/g, "SSO");
}
function topLevelSection(id) {
  if (id === "index.html" || id === "map.html") return "Home";
  const parts = id.split("/");
  if (parts.length < 2) return "More guides";
  return parts[0]
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(And|Or|Of|The)\b/g, (word) => word.toLowerCase())
    .replace(/\bSaas\b/g, "SaaS")
    .replace(/\bApi\b/g, "API")
    .replace(/\bSso\b/g, "SSO");
}
function docHeadings(src) {
  const hs = [];
  (src || "").split(/\r?\n/).forEach((ln) => { const m = ln.match(/^#{2,4}\s+(.+)/); if (m) hs.push(m[1].replace(/[*_`]/g, "").trim()); });
  return hs.join(" · ");
}
function docText(src, n) {
  const t = (src || "").replace(/```[\s\S]*?```/g, " ").replace(/^#{1,6}\s+/gm, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[>*_`|]/g, " ").replace(/\s+/g, " ").trim();
  return n && t.length > n ? t.slice(0, n) : t;
}
// h2/h3 headings with the same anchor slug enrichHeadings() assigns, so search can deep-link
// straight to the matching section. Mirrors that slug + de-duplication exactly.
function docHeadingsAnchored(src) {
  const used = new Set(), out = [];
  (src || "").replace(/```[\s\S]*?```/g, "").split(/\r?\n/).forEach((ln) => {
    const m = ln.match(/^(#{2,3})\s+(.+)/); if (!m) return;
    const text = m[2].replace(/\s*#+\s*$/, "").replace(/[*_`]/g, "").trim();
    let id = text.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "section";
    const base = id; let n = 1; while (used.has(id)) id = base + "-" + (++n); used.add(id);
    out.push({ t: text, a: id });
  });
  return out;
}
// a giscus theme CSS auto-derived from the manifest's brand colours (light + dark via color-mix)
function giscusTheme(manifest) {
  const ext = manifest.readme_site || {}, d = ext.dark || {};
  const comments = ext.comments || {};
  // structural overrides (left-aligned reactions, borders, …) live in one shared base file
  // in the folder2website repo, fetched over raw.githubusercontent (HTTPS + CORS). This
  // generated sheet only @imports it and layers the brand colours on top.
  const baseUrl = comments.themeBaseUrl || "https://raw.githubusercontent.com/spashii/folder2website/main/giscus-base.css";
  const font = ext.font ? '"' + String(ext.font).replace(/"/g, "") + '",' : "";
  const L = { bg: manifest.background_color || "#ffffff", fg: ext.fg || "#1f2328", acc: manifest.theme_color || "#0969da" };
  const D = { bg: d.bg || "#0d1117", fg: d.fg || "#e6edf3", acc: d.accent || L.acc };
  const mix = (a, p, b) => `color-mix(in srgb, ${a} ${p}%, ${b})`;
  const block = (c, primHover) => `
  --color-canvas-default:${c.bg};--color-canvas-overlay:${c.bg};
  --color-canvas-inset:${mix(c.bg, 94, c.fg)};--color-canvas-subtle:${mix(c.bg, 96, c.fg)};
  --color-fg-default:${c.fg};--color-fg-muted:${mix(c.fg, 64, c.bg)};--color-fg-subtle:${mix(c.fg, 45, c.bg)};
  --color-border-default:${mix(c.fg, 20, "transparent")};--color-border-muted:${mix(c.fg, 12, "transparent")};--color-neutral-muted:${mix(c.fg, 12, "transparent")};
  --color-accent-fg:${c.acc};--color-accent-emphasis:${c.acc};--color-accent-muted:${mix(c.acc, 40, "transparent")};--color-accent-subtle:${mix(c.acc, 12, "transparent")};
  --color-btn-text:${c.fg};--color-btn-bg:${c.bg};--color-btn-border:${mix(c.fg, 20, "transparent")};--color-btn-hover-bg:${mix(c.bg, 92, c.fg)};--color-btn-hover-border:${mix(c.fg, 30, "transparent")};--color-btn-active-bg:${mix(c.bg, 88, c.fg)};
  --color-btn-primary-text:#fff;--color-btn-primary-bg:${c.acc};--color-btn-primary-border:${mix(c.fg, 12, "transparent")};--color-btn-primary-hover-bg:${primHover};--color-btn-primary-hover-border:transparent;--color-btn-primary-selected-bg:${c.acc};
  --color-social-reaction-bg-hover:${mix(c.acc, 14, "transparent")};--color-social-reaction-bg-reacted-hover:${mix(c.acc, 22, "transparent")};`;
  return `@import url("${baseUrl}");
/*! giscus theme - colours auto-derived from manifest.json; structure from the folder2website base */
main{${block(L, L.fg)}
  font-family:${font}-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;}
@media (prefers-color-scheme: dark){main{${block(D, D.acc)}}}`;
}
const isLocal = (h) => h && !/^[a-z][a-z0-9+.-]*:/i.test(h) && !h.startsWith("//") && !h.startsWith("/") && !h.startsWith("#");
const outName = (rel) => {
  const i = rel.indexOf("#"), path = i >= 0 ? rel.slice(0, i) : rel, hash = i >= 0 ? rel.slice(i) : "";
  const html = extname(path)
    ? path.replace(/\.md$/i, ".html").replace(/(^|\/)(readme)\.html$/i, "$1index.html")
    : `${path}.html`;
  return html + hash;
};
const isPageLink = (href) => {
  const path = href.split("#")[0];
  const ext = extname(path).toLowerCase();
  return ext === ".md" || (!ext && !path.endsWith("/"));
};
const relativeDate = (date) => {
  if (!date) return "";
  const then = new Date(date.includes("T") ? date : `${date}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return date;
  const seconds = Math.max(0, Math.floor((Date.now() - then.getTime()) / 1000));
  if (seconds < 60) return "less than a minute ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  for (const [size, unit] of [[365, "year"], [30, "month"], [7, "week"], [1, "day"]]) {
    const n = Math.floor(days / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  }
};
const relAsset = (mdRel, p) => {
  const r = posix.normalize(posix.join(posix.dirname(mdRel), decodeURIComponent(p.split("#")[0])));
  return r.startsWith("..") ? null : r;
};

// --- marked plugins: smart typography, GitHub alerts, footnotes, Shiki ---
marked.use(markedSmartypants());
marked.use(markedAlert());
marked.use(markedFootnote());
const SHIKI = { themes: { light: "vitesse-light", dark: "vitesse-dark" }, defaultColor: "light" };
marked.use(markedShiki({
  highlight: async (code, lang) => {
    // ```mermaid fences skip Shiki and render client-side: emit the bare
    // <pre class="mermaid"> shape mermaid.js looks for. The script is only
    // included on pages that produced one (see hasMermaid in renderMd).
    if (lang === "mermaid") return `<pre class="mermaid">${esc(code)}</pre>`;
    for (const l of [lang, "text"]) {
      try {
        const out = await codeToHtml(code, { lang: l || "text", ...SHIKI });
        return lang && lang !== "text" ? out.replace("<pre ", `<pre data-lang="${esc(lang)}" `) : out;
      } catch {}
    }
    return `<pre class="shiki"><code>${esc(code)}</code></pre>`;
  },
}));

async function resolveRoot() {
  if (existsSync(target)) {
    const abs = resolve(target);
    return existsSync(join(abs, "README.md")) || !extname(abs) ? abs : posix.dirname(abs);
  }
  const url = target.startsWith("http") ? target : `https://github.com/${target}.git`;
  const auth = token ? url.replace("https://", `https://x-access-token:${token}@`) : url;
  const dest = clonePath ?? join(tmpdir(), "folder2website-clone", target.replace(/[^\w.-]+/g, "_"));
  if (existsSync(dest)) {
    if (!existsSync(join(dest, ".git"))) throw new Error(`clone path exists but is not a git repo: ${dest}`);
    console.log(`using existing clone: ${dest}`);
    console.log("not fetching or pulling automatically; if it may be stale, run:");
    console.log(`  git -C "${dest}" pull`);
    const status = await gitOut(["-C", dest, "status", "--short", "--branch"]);
    if (status) console.log(status.split("\n").map((l) => `  ${l}`).join("\n"));
    return dest;
  }
  mkdirSync(dirname(dest), { recursive: true });
  console.log(`cloning ${target} -> ${dest} ...`);
  await $`git clone ${auth} ${dest}`.quiet();
  console.log(`cloned to ${dest}`);
  return dest;
}

async function gitInfo(root) {
  const remote = await gitOut(["-C", root, "config", "--get", "remote.origin.url"]);
  const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!m) return null;
  const branch = (await gitOut(["-C", root, "rev-parse", "--abbrev-ref", "HEAD"])) || "main";
  return { repo: m[1], blob: `https://github.com/${m[1]}/blob/${branch}` };
}
const parseCommit = (line) => {
  const [hash, date, name, email] = line.split("\t");
  return hash ? { hash, date, name, email } : null;
};
const commitLog = async (root, f, args) => parseCommit(await gitOut(["-C", root, "log", ...args, "--format=%H%x09%cI%x09%an%x09%ae", "--", f]));
const loginFromEmail = (email = "") => email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i)?.[1] || "";
const loginFromName = (name = "") => /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(name) ? name : "";
const githubAuthorCache = new Map();
async function githubAuthor(repo, hash) {
  if (!repo || !hash) return "";
  const key = `${repo}:${hash}`;
  if (githubAuthorCache.has(key)) return githubAuthorCache.get(key);
  try {
    const headers = { "user-agent": "folder2website" };
    if (token) headers.authorization = `Bearer ${token}`;
    const r = await fetch(`https://api.github.com/repos/${repo}/commits/${hash}`, { headers });
    const login = r.ok ? (await r.json()).author?.login || "" : "";
    githubAuthorCache.set(key, login);
    return login;
  } catch {
    githubAuthorCache.set(key, "");
    return "";
  }
}
async function commitInfo(root, f, git, args) {
  const c = await commitLog(root, f, args);
  if (!c) return null;
  c.login = await githubAuthor(git?.repo, c.hash) || loginFromEmail(c.email) || loginFromName(c.name);
  return c;
}

async function loadManifest(root) {
  const p = manifestArg ? resolve(root, manifestArg) : join(root, "manifest.json");
  if (!existsSync(p)) {
    if (manifestArg) console.warn(`  manifest ignored: missing ${p}`);
    return null;
  }
  try {
    const manifest = JSON.parse(await readText(p));
    Object.defineProperty(manifest, "__path", { value: p });
    return manifest;
  }
  catch (e) { console.warn(`  manifest ignored: ${e.message}`); return null; }
}
function pickIcon(icons) {
  if (!Array.isArray(icons) || !icons.length) return null;
  const svg = icons.find((i) => i.type === "image/svg+xml" || /\.svg(\?|$)/.test(i.src || ""));
  if (svg) return svg.src;
  return [...icons].sort((a, b) => (parseInt(b.sizes) || 0) - (parseInt(a.sizes) || 0))[0]?.src || null;
}
const cssVar = (k, v) => `--${k}:${k === "font" && /\s/.test(v) && !/['"]/.test(v) ? `"${v}"` : v};`;
async function manifestCss(manifest, ext, root) {
  const decls = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => cssVar(k, v)).join("");
  let css = "";
  const light = decls({ bg: manifest.background_color, accent: manifest.theme_color, fg: ext.fg, muted: ext.muted, line: ext.line, font: ext.font, width: ext.width });
  if (light) css += `:root{${light}}`;
  if (ext.dark) {
    const d = decls({ bg: ext.dark.bg, fg: ext.dark.fg, muted: ext.dark.muted, line: ext.dark.line, accent: ext.dark.accent });
    if (d) css += `@media(prefers-color-scheme:dark){:root{${d}}}`;
  }
  if (ext.css) { const f = join(root, ext.css); if (existsSync(f)) css += "\n" + (await readText(f)); }
  return css ? `\n/* web app manifest */\n${css}\n` : "";
}

function enrichHeadings(body) {
  const toc = [], used = new Set();
  body = body.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, lvl, inner) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    let id = text.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "section";
    const base = id; let n = 1; while (used.has(id)) id = `${base}-${++n}`;
    used.add(id);
    toc.push({ lvl: +lvl, id, text });
    return `<h${lvl} id="${id}">${inner}<a class="anchor" href="#${id}" aria-hidden="true">#</a></h${lvl}>`;
  });
  const tocHtml = toc.length >= 3
    ? `<details class="toc"><summary>On this page</summary><ul>${toc.map((t) => `<li class="lvl${t.lvl}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join("")}</ul></details>`
    : "";
  return { body: tocHtml && body.includes("</h1>") ? body.replace("</h1>", "</h1>\n" + tocHtml) : tocHtml + body };
}

const standaloneMarkdownHref = (block) => block.match(/^\[[^\]]+\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)$/s)?.[1] || "";
const addHtmlClass = (attrs, names) => {
  const m = attrs.match(/\bclass="([^"]*)"/);
  return m
    ? attrs.replace(m[0], `class="${m[1]} ${names}"`)
    : `${attrs} class="${names}"`;
};
function markStandaloneActionLinks(body) {
  return body.replace(/<p([^>]*)>\s*<a([^>]*\bhref="([^"]+)"[^>]*)>([\s\S]*?)<\/a>\s*<\/p>/g, (full, pAttrs, aAttrs, href, label) => {
    if (!href || /<(?:img|picture|svg)\b/i.test(label)) return full;
    return `<p${addHtmlClass(pAttrs, "actions")}><a${addHtmlClass(aAttrs, "btn action-link")}>${label}</a></p>`;
  });
}

async function renderMd(src, mdRel, queue, seen, assets) {
  src = src.trim();
  // folder2website is frontmatter-less by design; our docs use YAML frontmatter, so strip
  // and lightly parse a leading --- block and let title/description seed the page metadata.
  const fm = {};
  const fmMatch = src.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (fmMatch) {
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (kv) fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
    src = src.slice(fmMatch[0].length).trim();
  }
  const title = fm.title || src.match(/^#\s+(.+)$/m)?.[1].trim() || posix.basename(mdRel);
  const tagline = fm.description || src.split(/\n\s*\n/).map((b) => b.trim())
    .find((b) => {
      if (!b || b.startsWith("#") || b.startsWith("![")) return false;
      return !standaloneMarkdownHref(b);
    })?.replace(/\s+/g, " ") || "";

  let body = await marked.parse(src);
  // ponytail: regexes over marked's own output (controlled input)
  body = body.replaceAll("<table>", '<div class="table-wrap" tabindex="0"><table>').replaceAll("</table>", "</table></div>");
  body = body.replace(/<p>((?:\s*<img[^>]*>\s*)+)<\/p>/g, (_m, imgs) =>
    `<div class="${(imgs.match(/<img/g) || []).length > 3 ? "shots" : "imgrow"}">${imgs}</div>`);
  body = markStandaloneActionLinks(body);
  body = body.replace(/<p((?![^>]*\bactions\b)[^>]*)>/, (_m, attrs) => `<p${addHtmlClass(attrs, "tagline")}>`);
  ({ body } = enrichHeadings(body));

  for (const m of body.matchAll(/<img[^>]*\bsrc="([^"]+)"/g))
    if (isLocal(m[1])) { const a = relAsset(mdRel, m[1]); if (a) assets.add(a); }
  const outLinks = new Set();
  body = body.replace(/(<a[^>]*\bhref=")([^"]+)(")/g, (full, a, href, b) => {
    if (!isLocal(href)) return full;
    const t = relAsset(mdRel, href);
    if (!t) return full;
    if (isPageLink(href)) {
      if (!seen.has(t)) queue.push(t);
      outLinks.add(t);            // record the link graph (for the site-graph viewer)
      return a + outName(href) + b;
    }
    assets.add(t);
    return full;
  });
  return { title, tagline, body, src, outLinks, hasMermaid: body.includes('<pre class="mermaid">') };
}

function authorHtml(commit) {
  if (!commit) return "";
  if (commit.login) return `<a href="https://github.com/${esc(commit.login)}">@${esc(commit.login)}</a>`;
  return esc(commit.name || commit.email || "unknown");
}
const commitLine = (label, commit) => commit ? `${label} ${relativeDate(commit.date)} by ${authorHtml(commit)}` : "";

function pageHtml({ title, tagline, body, theme, extraCss, depth, og, canonical, isIndex, siteTitle, logo, logoDark, editUrl, updated, created, twin, themeColor, themeColorDark, hasManifest, lang, langSwitch, hreflang, nav, isHome, graphJson, relatedPages, outRel, comments, hasMermaid, showGeneratorAttribution, showFooterActions, showRelatedPages }) {
  const prefix = "../".repeat(depth);
  const css = theme.replace(/url\("fonts\//g, `url("${prefix}fonts/`) + (extraCss || "");
  const favicon = logo;
  const iconType = (p) => p.endsWith(".svg") ? ' type="image/svg+xml"' : "";
  const icon = favicon
    ? `<link rel="icon" href="${esc(favicon)}"${iconType(favicon)}${logoDark ? ' media="(prefers-color-scheme: light)"' : ""} />\n    ${logoDark ? `<link rel="icon" href="${esc(logoDark)}"${iconType(logoDark)} media="(prefers-color-scheme: dark)" />\n    ` : ""}`
    : "";
  const ogTags = og ? `<meta property="og:image" content="${esc(og)}" />\n    <meta name="twitter:card" content="summary_large_image" />\n    ` : "";
  const canon = canonical ? `<link rel="canonical" href="${esc(canonical)}" />\n    ` : "";
  const tc = themeColor
    ? `<meta name="theme-color" content="${esc(themeColor)}"${themeColorDark ? ' media="(prefers-color-scheme: light)"' : ""} />\n    ${themeColorDark ? `<meta name="theme-color" content="${esc(themeColorDark)}" media="(prefers-color-scheme: dark)" />\n    ` : ""}`
    : "";
  const mani = hasManifest ? `<link rel="manifest" href="${prefix}manifest.json" />\n    ` : "";
  const heroLogo = (isIndex || isHome) && logo
    ? (logoDark
        ? `<img class="logo logo-on-light" src="${esc(logo)}" width="84" height="84" alt="${esc(siteTitle)} logo" /><img class="logo logo-on-dark" src="${esc(logoDark)}" width="84" height="84" alt="" aria-hidden="true" />\n      `
        : `<img class="logo" src="${esc(logo)}" width="84" height="84" alt="${esc(siteTitle)} logo" />\n      `)
    : "";
  const home = nav || "";
  const gitLink = editUrl ? `<a href="${esc(editUrl)}">Edit on GitHub</a>` : "";
  const copy = `<button class="linkish copy-md" data-md="${esc(twin)}">Copy as Markdown</button>`;
  const sameCommit = updated?.hash && created?.hash && updated.hash === created.hash;
  const lines = [sameCommit ? "" : commitLine("Updated", updated), commitLine("Created", created)].filter(Boolean);
  const madeWith = showGeneratorAttribution
    ? `<div class="meta-line">Website made with <a href="https://github.com/spashii/folder2website" data-popover-title="spashii/folder2website" data-popover-description="Point it at a repo or any markdown folder, get a clean website.">spashii/folder2website</a></div>`
    : "";
  // Search and the knowledge graph live in the top-right controls, not the footer.
  const actions = showFooterActions ? `<div class="meta-actions">${[gitLink, copy].filter(Boolean).join(" · ")}</div>` : "";
  const metaBody = actions + lines.map((line) => `<div class="meta-line">${line}</div>`).join("") + madeWith;
  const meta = metaBody ? `\n      <footer class="meta">${metaBody}</footer>` : "";
  const graphIcon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5.2 5.7 8 8m4.8-2.3L10 8m-1 2.2v2.3"/><circle cx="4" cy="4.5" r="2"/><circle cx="14" cy="4.5" r="2"/><circle cx="9" cy="14.5" r="2"/><circle cx="9" cy="9" r="1.7"/></svg>`;
  const settingsIcon = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M2 4h3m3 0h8M2 9h8m3 0h3M2 14h5m3 0h6"/><circle cx="6.5" cy="4" r="1.5"/><circle cx="11.5" cy="9" r="1.5"/><circle cx="8.5" cy="14" r="1.5"/></svg>`;
  const graphModal = `<div class="graph-modal" hidden aria-hidden="true" role="dialog" aria-label="Knowledge graph">
      <div class="graph-bar">
        <div class="graph-bar-left"><button type="button" class="graph-back">← Back</button></div>
        <div class="graph-bar-right"><button type="button" class="graph-overview" aria-label="Show whole graph" title="Show whole graph">${graphIcon}</button><div class="graph-settings"><button type="button" class="graph-gear" aria-haspopup="true" aria-expanded="false" aria-label="Settings" title="Settings">${settingsIcon}</button><div class="graph-menu" hidden><label class="graph-opt"><input type="checkbox" class="graph-backlinks" /> Show backlinks</label></div></div></div>
      </div>
      <div class="graph-stage">
        <canvas class="graph-canvas"></canvas>
        <aside class="graph-detail" hidden><strong class="gd-title"></strong><span class="gd-desc"></span><span class="gd-meta"></span><div class="gd-actions"><a class="gd-open" href="#">Open page →</a><button type="button" class="gd-recenter" hidden>Recenter</button></div></aside>
      </div>
    </div>
    <script type="application/json" class="site-graph-data">${(graphJson || "{}").replace(/</g, "\\u003c")}</script>`;
  // small search and graph icons that sit beside the language picker
  const searchToggle = `<button type="button" class="ds-toggle search-open" aria-label="Search" title="Search"><svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="7" cy="7" r="4.6"/><line x1="10.6" y1="10.6" x2="14.5" y2="14.5" stroke-linecap="round"/></svg></button>`;
  const graphToggle = `<button type="button" class="ds-toggle graph-open graph-open-overview" aria-label="Open knowledge graph" title="Knowledge graph">${graphIcon}</button>`;
  const topRight = `<div class="topbar">${searchToggle}${graphToggle}${langSwitch || ""}</div>`;
  const searchPanel = `<div class="docsearch" hidden role="search">
        <div class="ds-field">
          <span class="ds-ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="4.6"/><line x1="10.6" y1="10.6" x2="14.5" y2="14.5" stroke-linecap="round"/></svg></span>
          <input type="search" class="ds-input" placeholder="Search the docs…" aria-label="Search the docs" aria-controls="docsearch-results" aria-expanded="false" aria-keyshortcuts="/ Control+K Meta+K" autocomplete="off" spellcheck="false" />
        </div>
        <div class="ds-results" id="docsearch-results" role="listbox" aria-label="Search results" hidden></div>
      </div>`;
  const commentsHtml = comments ? `\n      <section class="comments" aria-label="Comments">
        <h2>Comments</h2>
        <script src="https://giscus.app/client.js" data-repo="${esc(comments.repo)}" data-repo-id="${esc(comments.repoId)}" data-category="${esc(comments.category || "")}" data-category-id="${esc(comments.categoryId || "")}" data-mapping="${esc(comments.mapping || "pathname")}" data-strict="0" data-reactions-enabled="${comments.reactions === false ? "0" : "1"}" data-emit-metadata="0" data-input-position="${esc(comments.inputPosition || "top")}" data-theme="${esc(comments.themeUrl)}" data-lang="${esc(comments.lang || "en")}" data-loading="lazy" crossorigin="anonymous" async></script>
      </section>` : "";
  const relatedGroups = (relatedPages || []).map((group) => `<section class="related-group">
          <h3>${esc(group.label)}</h3>
          <ul>${group.pages.map((page) => `<li><a href="${esc(prefix + page.id)}">${esc(page.title)}</a></li>`).join("")}</ul>
        </section>`).join("");
  const localGraph = showRelatedPages && relatedGroups ? `\n      <section class="localmap" aria-label="Related pages">
        <div class="localmap-head"><h2>Related pages</h2><button type="button" class="localmap-explore graph-open graph-open-current">Explore in graph →</button></div>
        <div class="related-grid">${relatedGroups}</div>
      </section>` : "";
  const script = `<script>
for (const b of document.querySelectorAll(".copy-md")) b.onclick = async () => {
  await navigator.clipboard.writeText(await (await fetch(b.dataset.md)).text());
  const o = b.textContent; b.textContent = "Copied"; setTimeout(() => b.textContent = o, 900);
};
for (const p of document.querySelectorAll("pre.shiki")) {
  const b = document.createElement("button"); b.className = "copy-code"; b.textContent = "Copy";
  b.onclick = async () => {
    await navigator.clipboard.writeText(p.querySelector("code")?.innerText ?? p.innerText);
    const o = b.textContent; b.textContent = "Copied"; setTimeout(() => b.textContent = o, 900);
  };
  p.appendChild(b);
}
(() => {
  const box = document.createElement("div"); box.className = "lightbox"; box.hidden = true;
  const img = document.createElement("img");
  const closeButton = document.createElement("button"); closeButton.type = "button"; closeButton.textContent = "Close"; closeButton.setAttribute("aria-label", "Close image preview");
  box.append(img, closeButton); document.body.appendChild(box);
  const close = () => { box.hidden = true; document.body.classList.remove("lightbox-open"); img.removeAttribute("src"); };
  const open = (source) => { img.src = source.currentSrc || source.src; img.alt = source.alt || ""; box.hidden = false; document.body.classList.add("lightbox-open"); closeButton.focus(); };
  for (const source of document.querySelectorAll(".wrap img:not(.logo)")) {
    source.tabIndex = 0; source.setAttribute("role", "button"); source.setAttribute("aria-label", "Open image preview");
    source.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); open(source); });
    source.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(source); } });
  }
  box.addEventListener("click", (e) => { if (e.target === box || e.target === closeButton) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) close(); });
})();
(() => {
  const c = {}; let pop;
  async function load(h) {
    if (c[h]) return c[h];
    const m = (window.__docMeta && window.__docMeta(h)) || null; // resolve via embedded data (no fetch -> works on file://)
    return c[h] = m ? { t: m.t, d: m.d } : { t: "", d: "" };
  }
  for (const a of document.querySelectorAll('.wrap a[href$=".html"], .wrap a.home, .wrap a[data-popover-title]')) {
    let tm;
    a.addEventListener("mouseenter", () => {
      tm = setTimeout(async () => {
        const preview = a.dataset.popoverTitle ? { t: a.dataset.popoverTitle, d: a.dataset.popoverDescription || "" } : await load(a.href);
        const { t, d } = preview; if (!t) return;
        pop?.remove(); pop = document.createElement("div"); pop.className = "popover";
        const s = document.createElement("strong"); s.textContent = t; pop.appendChild(s);
        if (d) { const x = document.createElement("span"); x.textContent = d; pop.appendChild(x); }
        document.body.appendChild(pop);
        const r = a.getBoundingClientRect(), gap = 8, pad = 12;
        const left = Math.max(pad, Math.min(r.left, innerWidth - pop.offsetWidth - pad));
        let top = r.bottom + gap;
        if (top + pop.offsetHeight > innerHeight - pad) top = r.top - pop.offsetHeight - gap;
        pop.style.left = left + "px";
        pop.style.top = Math.max(pad, top) + "px";
      }, 180);
    });
    a.addEventListener("mouseleave", () => { clearTimeout(tm); pop?.remove(); pop = null; });
  }
})();
(() => {
  const PREFIX = ${JSON.stringify(prefix)};
  const CURRENT = ${JSON.stringify(outRel)};
  const modal = document.querySelector(".graph-modal");
  const openers = document.querySelectorAll(".graph-open");
  if (!modal || !openers.length) return;
  const stage = modal.querySelector(".graph-stage");
  const canvas = modal.querySelector(".graph-canvas");
  const backBtn = modal.querySelector(".graph-back");
  const overviewBtn = modal.querySelector(".graph-overview");
  const backBox = modal.querySelector(".graph-backlinks");
  const settingsWrap = modal.querySelector(".graph-settings"), gear = modal.querySelector(".graph-gear"), gmenu = modal.querySelector(".graph-menu");
  const detail = modal.querySelector(".graph-detail");
  const gdTitle = modal.querySelector(".gd-title"), gdDesc = modal.querySelector(".gd-desc"), gdMeta = modal.querySelector(".gd-meta"), gdOpen = modal.querySelector(".gd-open"), gdRecenter = modal.querySelector(".gd-recenter");
  const ctx = canvas.getContext("2d");
  let nodes = [], links = [], raf = 0, ready = false, loaded = false, fitDone = false, cur = null;
  let W = 0, H = 0, hover = null, selected = null, showBacklinks = false, drag = null, pan = null, moved = false, userCam = false, fitS = 1;
  let history = [];
  const cam = { x: 0, y: 0, s: 1 };
  let camGoal = null, sim = null;
  // physics: the real d3-force engine (vendored) - same one ddw uses via react-force-graph
  const CHARGE = -300, LINK_DIST = 70, COLLIDE_PAD = 4, COLLIDE_STR = 0.85;
  const DPR = () => Math.min(2, window.devicePixelRatio || 1);
  const rad = (n) => 4 + Math.min(9, n.deg * 1.4);
  // parse the embedded graph data once - powers the graph AND in-page hover previews (no fetch)
  let GDATA = null; const byId = new Map();
  try { const el = document.querySelector("script.site-graph-data"); GDATA = el ? JSON.parse(el.textContent) : null; if (GDATA) GDATA.nodes.forEach((n) => byId.set(n.id, n)); } catch (e) {}
  const rootUrl = (() => { try { return new URL(PREFIX || "./", location.href).href; } catch (e) { return null; } })();
  function hrefToId(href) { try { const abs = new URL(href, location.href).href.split("#")[0].split("?")[0]; if (!rootUrl || !abs.startsWith(rootUrl)) return null; let id = abs.slice(rootUrl.length); if (id === "" || id.endsWith("/")) id += "index.html"; return decodeURIComponent(id); } catch (e) { return null; } }
  window.__docMeta = (href) => { const n = byId.get(hrefToId(href)); return n ? { t: n.t, d: n.d } : null; };
  // Persist the optional backlink layer. The overview itself stays quiet.
  const SKEY = "folder2website-graph-settings";
  const _saved = (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; } })();
  showBacklinks = _saved.backlinks === true;
  const saveSettings = () => { try { localStorage.setItem(SKEY, JSON.stringify({ backlinks: showBacklinks })); } catch (e) {} };
  if (backBox) backBox.checked = showBacklinks;
  // Derive clusters from the first folder so the graph works for any documentation set.
  const sections = [], sectionByKey = new Map();
  const words = (value) => value.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(And|Or|Of|The)\b/g, (word) => word.toLowerCase()).replace(/\bSaas\b/g, "SaaS").replace(/\bApi\b/g, "API").replace(/\bSso\b/g, "SSO");
  function sectionOf(id) {
    const home = id === "index.html" || id === "map.html";
    const parts = id.split("/");
    const key = home ? "home" : parts.length > 1 ? parts[0] : "more";
    if (sectionByKey.has(key)) return sectionByKey.get(key);
    const section = { key, label: home ? "Home" : key === "more" ? "More guides" : words(key), index: sections.length, x: 0, y: 0 };
    sections.push(section); sectionByKey.set(key, section); return section;
  }
  // canvas colours follow the generated or custom page theme
  const cssColor = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const TH = () => ({ bg: cssColor("--bg", "#ffffff"), fg: cssColor("--fg", "#1f2328"), muted: cssColor("--muted", "#667085"), line: cssColor("--line", "#d0d5dd"), accent: cssColor("--accent", "#0969da") });
  function load() {
    if (loaded) return; loaded = true;
    try {
      const g = GDATA;
      if (!g || !g.nodes) return;
      const idx = new Map();
      const GA = Math.PI * (3 - Math.sqrt(5)); // phyllotaxis seeding (d3 default) - no initial overlap
      nodes = g.nodes.map((n, i) => { idx.set(n.id, i); const r = 12 * Math.sqrt(0.5 + i), a = i * GA; return Object.assign({}, n, { i, x: r * Math.cos(a), y: r * Math.sin(a), vx: 0, vy: 0, deg: 0, fx: null, fy: null, sec: sectionOf(n.id), out: new Set(), inc: new Set() }); });
      links = g.links.map((l) => ({ s: idx.get(l.s), t: idx.get(l.t) })).filter((l) => l.s != null && l.t != null);
      // directional: out = forward links, inc = backlinks. dedupe undirected pairs for drawing.
      const seen = new Set();
      for (const e of links) { nodes[e.s].out.add(e.t); nodes[e.t].inc.add(e.s); const k = Math.min(e.s, e.t) + ":" + Math.max(e.s, e.t); e.dup = seen.has(k); seen.add(k); }
      for (const n of nodes) { const u = new Set(n.out); n.inc.forEach((x) => u.add(x)); n.deg = u.size; }
      const clusterRadius = Math.min(220, 90 + nodes.length * 3);
      sections.forEach((section, i) => { const angle = -Math.PI / 2 + i * 6.2832 / Math.max(1, sections.length); section.x = Math.cos(angle) * clusterRadius; section.y = Math.sin(angle) * clusterRadius; });
      cur = nodes.find((n) => n.id === CURRENT) || null;
      const D3 = window.d3;
      if (D3) {
        const linkObjs = links.map((e) => ({ source: nodes[e.s], target: nodes[e.t] }));
        sim = D3.forceSimulation(nodes)
          .force("charge", D3.forceManyBody().strength(CHARGE))
          .force("link", D3.forceLink(linkObjs).distance(LINK_DIST))
          .force("center", D3.forceCenter(0, 0))
          .force("sectionX", D3.forceX((n) => n.sec.x).strength(0.12))
          .force("sectionY", D3.forceY((n) => n.sec.y).strength(0.12))
          .force("collide", D3.forceCollide().radius((n) => rad(n) + COLLIDE_PAD).strength(COLLIDE_STR))
          .stop();
      }
      ready = true;
    } catch (e) {}
  }
  // a node's neighbourhood: itself + forward links (+ backlinks when the toggle is on)
  function neighbours(f) { const s = new Set([f.i]); f.out.forEach((x) => s.add(x)); if (showBacklinks) f.inc.forEach((x) => s.add(x)); return s; }
  // Focus mode uses a stable radial layout. It does not inherit the compressed positions
  // from the whole-site simulation, so direct relationships remain readable.
  function focusLayout(f) {
    const ids = [...neighbours(f)].filter((i) => i !== f.i).sort((a, b) => {
      const ad = f.out.has(a) ? 0 : 1, bd = f.out.has(b) ? 0 : 1;
      return ad - bd || nodes[a].t.localeCompare(nodes[b].t);
    });
    const radius = 92 + Math.min(96, ids.length * 8), map = new Map([[f.i, { x: f.x, y: f.y }]]);
    ids.forEach((id, i) => { const angle = -Math.PI / 2 + i * 6.2832 / Math.max(1, ids.length); map.set(id, { x: f.x + Math.cos(angle) * radius, y: f.y + Math.sin(angle) * radius }); });
    return map;
  }
  function resize() { const r = canvas.getBoundingClientRect(); W = r.width; H = r.height; const d = DPR(); canvas.width = Math.max(1, W * d); canvas.height = Math.max(1, H * d); }
  function toWorld(px, py) { return { x: (px - W / 2 - cam.x) / cam.s, y: (py - H / 2 - cam.y) / cam.s }; }
  function tick() {
    if (!sim) return false;
    if (sim.alpha() < sim.alphaMin() && sim.alphaTarget() === 0) return false;
    sim.tick();
    return true;
  }
  function fit() { if (!nodes.length) return; let maxR = 1; for (const n of nodes) maxR = Math.max(maxR, Math.hypot(n.x, n.y) + rad(n)); fitS = Math.max(0.25, Math.min(2, (Math.min(W, H) / 2 - 40) / maxR)); }
  // zoom that frames a node + its visible neighbourhood
  function focusZoom(f) { const layout = focusLayout(f); let maxR = 30; layout.forEach((p, i) => { maxR = Math.max(maxR, Math.hypot(p.x - f.x, p.y - f.y) + rad(nodes[i])); }); return Math.max(0.5, Math.min(2.2, (Math.min(W, H) / 2 - 70) / (maxR + 30))); }
  // smooth camera: a goal (centre selected, or fit-all) that cam lerps toward each frame
  function updateCamGoal() { if (userCam) { camGoal = null; return; } if (selected) { const z = focusZoom(selected); camGoal = { s: z, x: -selected.x * z, y: -selected.y * z }; } else camGoal = { s: fitS, x: 0, y: 0 }; }
  function stepCam() { if (!camGoal) return; cam.s += (camGoal.s - cam.s) * 0.14; cam.x += (camGoal.x - cam.x) * 0.14; cam.y += (camGoal.y - cam.y) * 0.14; }
  // which nodes to *try* to label, in priority order. On hover: the focused neighbourhood.
  // Otherwise: hubs first, with a zoom-adaptive degree gate (zoomed out -> only big hubs).
  function labelOrder(f) {
    if (f) { const a = [...neighbours(f)].map((i) => nodes[i]); a.sort((x, y) => x === f ? -1 : y === f ? 1 : y.deg - x.deg); return a; }
    return [];
  }
  function draw() {
    const d = DPR(); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H);
    const C = TH(), f = selected || hover, nset = f ? neighbours(f) : null;
    const focused = !!selected, layout = focused ? focusLayout(selected) : null;
    const pos = (n) => layout?.get(n.i) || n;
    // world space: edges + nodes
    ctx.save(); ctx.translate(W / 2 + cam.x, H / 2 + cam.y); ctx.scale(cam.s, cam.s);
    for (const e of links) {
      if (!f) continue; // proximity and section clusters carry the overview
      let lit = false, back = false;
      if (f) { if (e.s === f.i) lit = true; else if (showBacklinks && e.t === f.i && !f.out.has(e.s)) { lit = true; back = true; } }
      if (!lit) continue;
      ctx.strokeStyle = C.line; ctx.globalAlpha = back ? 0.65 : 1;
      ctx.lineWidth = (back ? 0.7 : 1) / cam.s;
      const a = pos(nodes[e.s]), b = pos(nodes[e.t]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const n of nodes) {
      if (focused && !nset.has(n.i)) continue;
      const lit = !f || nset.has(n.i);
      ctx.globalAlpha = lit ? 1 : 0.1;
      const big = n === f || n === selected || n === cur;
      const screenRadius = rad(n) * (big ? 1.4 : 1);
      const p = pos(n);
      ctx.beginPath(); ctx.arc(p.x, p.y, screenRadius / cam.s, 0, 6.2832);
      ctx.fillStyle = big ? C.accent : C.muted; ctx.fill();
      if (n === f || n === selected) { ctx.lineWidth = 2 / cam.s; ctx.strokeStyle = C.fg; ctx.stroke(); }
      if (n === cur) { ctx.beginPath(); ctx.arc(p.x, p.y, (rad(n) * 1.4 + 5) / cam.s, 0, 6.2832); ctx.lineWidth = 1.5 / cam.s; ctx.strokeStyle = C.accent; ctx.stroke(); } // "you are here"
    }
    ctx.globalAlpha = 1; ctx.restore();
    // Screen space: the overview labels sections; focused and hovered nodes label one hop.
    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (!f) {
      ctx.font = "600 13px system-ui, -apple-system, sans-serif"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
      for (const section of sections) {
        const members = nodes.filter((n) => n.sec === section); if (!members.length) continue;
        const sx = members.reduce((sum, n) => sum + W / 2 + cam.x + n.x * cam.s, 0) / members.length;
        const sy = members.reduce((sum, n) => sum + H / 2 + cam.y + n.y * cam.s, 0) / members.length - 24;
        ctx.lineWidth = 5; ctx.strokeStyle = C.bg; ctx.strokeText(section.label, sx, sy); ctx.fillStyle = C.fg; ctx.fillText(section.label, sx, sy);
      }
      ctx.textAlign = "start";
    }
    ctx.font = "12px system-ui, -apple-system, sans-serif"; ctx.textBaseline = "middle";
    const placed = [];
    for (const n of labelOrder(f)) {
      const p = pos(n), sx = W / 2 + cam.x + p.x * cam.s, sy = H / 2 + cam.y + p.y * cam.s;
      if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
      const big = n === f || n === selected || n === cur;
      const w = ctx.measureText(n.t).width, lx = sx + rad(n) * (big ? 1.4 : 1) + 5;
      const box = { x: lx - 2, y: sy - 9, w: w + 4, h: 18 };
      let clash = false; for (const p of placed) { if (box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y) { clash = true; break; } }
      if (clash) continue;
      placed.push(box);
      ctx.lineWidth = 3; ctx.strokeStyle = C.bg; ctx.strokeText(n.t, lx, sy);
      ctx.globalAlpha = (n === f || n === cur) ? 1 : 0.7; ctx.fillStyle = C.fg; ctx.fillText(n.t, lx, sy); ctx.globalAlpha = 1;
      if (placed.length > 44) break;
    }
  }
  function loop() { if (ready) { tick(); if (!fitDone && sim && sim.alpha() < 0.25) { fit(); fitDone = true; } updateCamGoal(); stepCam(); draw(); } raf = requestAnimationFrame(loop); }
  function pick(px, py) { const w = toWorld(px, py), layout = selected ? focusLayout(selected) : null, visible = selected ? neighbours(selected) : null; let best = null, bd = Infinity; for (const n of nodes) { if (visible && !visible.has(n.i)) continue; const p = layout?.get(n.i) || n, dx = p.x - w.x, dy = p.y - w.y, dd = dx * dx + dy * dy, big = n === selected || n === cur, rr = (rad(n) * (big ? 1.4 : 1) + 8) / cam.s; if (dd < rr * rr && dd < bd) { bd = dd; best = n; } } return best; }
  // The detail rail represents persistent selection. Hover only previews relationships on
  // the canvas, so the layout does not jump while the pointer moves across the overview.
  function syncRecenter() { gdRecenter.hidden = !selected || !userCam; }
  function renderDetail() {
    const f = selected;
    stage.classList.toggle("has-detail", !!f);
    if (!f) { detail.hidden = true; return; }
    detail.hidden = false;
    gdTitle.textContent = f.t; gdDesc.textContent = f.d || "";
    const back = f.inc.size;
    gdMeta.textContent = f.out.size + (f.out.size === 1 ? " link" : " links") + (back ? " · " + back + " backlink" + (back === 1 ? "" : "s") : "") + (f.id === CURRENT ? " · you are here" : "");
    gdOpen.href = PREFIX + f.id + (f.id !== CURRENT ? "?from=" + encodeURIComponent(CURRENT) : "");
    syncRecenter();
    gdRecenter.onclick = () => { userCam = false; syncRecenter(); updateCamGoal(); };
  }
  function applySelection(n) { selected = n || null; hover = null; userCam = false; overviewBtn.disabled = !selected; updateCamGoal(); renderDetail(); }
  function select(n, remember = true) { if (!n || n === selected) return; if (remember) history.push(selected); applySelection(n); }
  function showOverview(remember = true) { if (!selected) return; if (remember) history.push(selected); applySelection(null); }
  function goBack() { if (history.length) applySelection(history.pop()); else close(); }
  function close() { modal.hidden = true; modal.setAttribute("aria-hidden", "true"); document.body.classList.remove("graph-open-body"); cancelAnimationFrame(raf); raf = 0; hover = null; selected = null; history = []; }
  function open() { modal.hidden = false; modal.setAttribute("aria-hidden", "false"); document.body.classList.add("graph-open-body"); load(); resize(); if (sim) { sim.alpha(1); sim.alphaTarget(0); } fitDone = false; userCam = false; hover = null; history = []; applySelection(null); if (!raf) loop(); }
  function openFocused(id) { open(); const n = nodes.find((x) => x.id === id); if (n) applySelection(n); }
  // Opening from a page focuses that page. Back returns to the document; the graph icon
  // moves to the overview without pretending to be browser navigation.
  openers.forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); if (b.classList.contains("graph-open-current") && CURRENT && byId.get(CURRENT)) openFocused(CURRENT); else open(); }));
  backBtn.addEventListener("click", goBack);
  overviewBtn.addEventListener("click", () => showOverview());
  backBox.addEventListener("change", () => { showBacklinks = backBox.checked; saveSettings(); updateCamGoal(); renderDetail(); });
  gear.addEventListener("click", (e) => { e.stopPropagation(); const willOpen = gmenu.hidden; gmenu.hidden = !willOpen; gear.setAttribute("aria-expanded", String(willOpen)); });
  document.addEventListener("click", (e) => { if (settingsWrap && !settingsWrap.contains(e.target)) { gmenu.hidden = true; gear.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) goBack(); });
  addEventListener("resize", () => { if (!modal.hidden) resize(); });
  canvas.addEventListener("pointerdown", (e) => { const r = canvas.getBoundingClientRect(); moved = false; const n = pick(e.clientX - r.left, e.clientY - r.top); if (n) { drag = n; n.fx = n.x; n.fy = n.y; if (sim) { sim.alphaTarget(0.3); if (sim.alpha() < 0.3) sim.alpha(0.3); } } else pan = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (drag) { const w = toWorld(px, py); drag.fx = w.x; drag.fy = w.y; moved = true; return; }
    if (pan) { cam.x += e.clientX - pan.x; cam.y += e.clientY - pan.y; pan = { x: e.clientX, y: e.clientY }; moved = true; userCam = true; syncRecenter(); camGoal = null; return; }
    const n = pick(px, py); if (n !== hover) { hover = n; renderDetail(); } canvas.style.cursor = n ? "pointer" : "grab";
  });
  canvas.addEventListener("pointerup", () => {
    if (drag) { if (!moved) select(drag); drag.fx = null; drag.fy = null; if (sim) sim.alphaTarget(0); drag = null; }   // click node = focus + zoom (persists)
    else if (pan) { if (!moved) showOverview(); pan = null; }
  });
  canvas.addEventListener("pointerleave", () => { hover = null; renderDetail(); });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); userCam = true; syncRecenter(); camGoal = null; cam.s = Math.max(0.3, Math.min(3, cam.s * Math.exp(-e.deltaY * 0.001))); }, { passive: false });
  // arrived via the graph (?from=...)? offer a way back to where we came from
  (function () {
    const from = new URLSearchParams(location.search).get("from");
    if (from == null) return; // a "from" param means we arrived by clicking a node in the graph
    const a = document.createElement("a");
    a.className = "back-chip"; a.href = PREFIX + from; a.textContent = "← Back to graph";
    a.addEventListener("click", (ev) => { ev.preventDefault(); openFocused(from); });
    document.body.appendChild(a);
  })();
})();
(() => {
  // Inline site search. Each hit deep-links to the heading that best matches the query.
  const PREFIX = ${JSON.stringify(prefix)}, CURRENT = ${JSON.stringify(outRel)};
  const box = document.querySelector(".docsearch");
  if (!box) return;
  const input = box.querySelector(".ds-input"), results = box.querySelector(".ds-results");
  const openers = document.querySelectorAll(".search-open");
  let mini = null, loaded = false, hop = {}, active = -1, hitEls = [];
  const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function computeHop() {
    try {
      const el = document.querySelector("script.site-graph-data"); const g = el ? JSON.parse(el.textContent) : null; if (!g) return;
      const adj = {}; g.nodes.forEach((n) => adj[n.id] = []);
      g.links.forEach((l) => { if (adj[l.s] && adj[l.t]) { adj[l.s].push(l.t); adj[l.t].push(l.s); } });
      const q = [CURRENT]; hop[CURRENT] = 0;
      while (q.length) { const u = q.shift(); (adj[u] || []).forEach((v) => { if (hop[v] == null) { hop[v] = hop[u] + 1; q.push(v); } }); }
    } catch (e) {}
  }
  function show(html) {
    results.innerHTML = html; results.hidden = false; input.setAttribute("aria-expanded", "true");
    active = -1; hitEls = [...results.querySelectorAll(".ds-hit")];
    hitEls.forEach((el, i) => el.addEventListener("pointermove", () => activate(i)));
  }
  function hide() { results.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); active = -1; hitEls = []; }
  function activate(i) {
    if (!hitEls.length) return;
    active = (i + hitEls.length) % hitEls.length;
    hitEls.forEach((el, n) => el.setAttribute("aria-selected", n === active ? "true" : "false"));
    input.setAttribute("aria-activedescendant", hitEls[active].id);
    hitEls[active].scrollIntoView({ block: "nearest" });
  }
  async function ensure() {
    if (loaded) return; loaded = true; computeHop();
    try {
      const docs = await (await fetch(PREFIX + "search-index.json")).json();
      const MS = window.MiniSearch;
      mini = new MS({ fields: ["t", "k", "x"], storeFields: ["t", "d", "s", "id", "h", "x"], searchOptions: { boost: { t: 5, k: 3, x: 1 }, prefix: true, fuzzy: 0.2, combineWith: "AND" } });
      mini.addAll(docs);
    } catch (e) { show('<div class="ds-empty">Search works on the published site.</div>'); }
  }
  // pick the heading that shares the most query terms - that is the section to jump to
  function bestHeading(r, terms) {
    if (!r.h || !r.h.length || !terms.length) return null;
    let best = null, bestN = 0;
    r.h.forEach((hd) => { const lt = (hd.t || "").toLowerCase(); let n = 0; terms.forEach((t) => { if (t && lt.indexOf(t) >= 0) n++; }); if (n > bestN) { bestN = n; best = hd; } });
    return bestN > 0 ? best : null;
  }
  function snippet(r, terms) {
    const text = (r.x || r.d || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    const lower = text.toLowerCase();
    let at = -1;
    terms.forEach((term) => { const i = lower.indexOf(term); if (i >= 0 && (at < 0 || i < at)) at = i; });
    if (at < 0) return text.length > 150 ? text.slice(0, 147).replace(/\s+\S*$/, "") + "…" : text;
    let start = Math.max(0, at - 55), end = Math.min(text.length, at + 115);
    if (start) start = text.indexOf(" ", start) + 1;
    if (end < text.length) { const space = text.lastIndexOf(" ", end); if (space > start) end = space; }
    return (start ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
  }
  function run(q) {
    q = (q || "").trim();
    if (!mini || !q) { results.innerHTML = ""; hide(); return; }
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    let r = mini.search(q);
    if (!r.length && terms.length > 1) r = mini.search(q, { combineWith: "OR" });
    r.forEach((x) => { const h = hop[x.id]; x._rank = x.score - (h != null ? Math.min(h, 6) * x.score * 0.04 : 0); }); // relevance dominates; nearer pages edge ahead
    r.sort((a, b) => b._rank - a._rank);
    const hits = r.slice(0, 10);
    if (!hits.length) { show('<div class="ds-empty">No matches for “' + esc(q) + '”. Try fewer or more general words.</div>'); return; }
    show(hits.map((x, i) => {
      const hd = bestHeading(x, terms);
      const href = PREFIX + esc(x.id) + (hd ? "#" + esc(hd.a) : "");
      return '<a class="ds-hit" id="docsearch-hit-' + i + '" data-hit-index="' + i + '" role="option" aria-selected="false" href="' + href + '"><span class="ds-top"><strong>' + esc(x.t) + "</strong>"
        + (x.s ? '<span class="ds-sec">' + esc(x.s) + "</span>" : "") + "</span>"
        + (hd ? '<span class="ds-where">→ ' + esc(hd.t) + "</span>" : "")
        + '<span class="ds-desc">' + esc(snippet(x, terms)) + "</span>"
        + "</a>";
    }).join(""));
  }
  function openPanel() { box.hidden = false; ensure().then(() => { input.focus(); if (input.value.trim()) run(input.value); }); }
  function closePanel() { box.hidden = true; hide(); }
  openers.forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); box.hidden ? openPanel() : closePanel(); }));
  input.addEventListener("input", () => { if (loaded) run(input.value); else ensure().then(() => run(input.value)); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closePanel(); return; }
    if (e.key === "ArrowDown" && hitEls.length) { e.preventDefault(); activate(active + 1); }
    if (e.key === "ArrowUp" && hitEls.length) { e.preventDefault(); activate(active < 0 ? hitEls.length - 1 : active - 1); }
    if (e.key === "Enter" && active >= 0 && hitEls[active]) { e.preventDefault(); hitEls[active].click(); }
  });
  document.addEventListener("click", (e) => { if (box.hidden || box.contains(e.target) || (e.target.closest && e.target.closest(".search-open"))) return; closePanel(); });
  document.addEventListener("keydown", (e) => {
    const t = e.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
    if (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); openPanel(); }
  });
})();
(() => {
  // arriving at #section (e.g. via a search hit): briefly flash that heading so it is easy to spot
  function flash() {
    const raw = location.hash.slice(1); if (!raw) return;
    let el = null; try { el = document.getElementById(decodeURIComponent(raw)); } catch (e) {}
    if (!el) return;
    el.classList.remove("section-flash"); void el.offsetWidth; el.classList.add("section-flash");
    setTimeout(() => el.classList.remove("section-flash"), 1900);
  }
  addEventListener("hashchange", flash);
  if (location.hash) setTimeout(flash, 90);
})();
</script>`;
  return `<!DOCTYPE html>
<html lang="${esc(lang || "en")}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(tagline)}" />
    ${canon}${hreflang || ""}${tc}${mani}${icon}<meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(tagline)}" />
    ${ogTags}<style>
${css}
    </style>
  </head>
  <body>
    <main class="wrap">
      ${topRight}${home}${heroLogo}${body}${localGraph}${commentsHtml}${meta}
    </main>
    ${searchPanel}
    ${graphModal}
    <script src="${prefix}d3-force.js"></script>
    <script src="${prefix}minisearch.min.js"></script>
    ${hasMermaid ? `<script src="${prefix}mermaid.min.js"></script>
    <script>mermaid.initialize({ startOnLoad: false, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "neutral" });
    document.fonts.ready.then(() => mermaid.run());</script>
    ` : ""}${script}
  </body>
</html>
`;
}

function detectReadme(root) {
  return ["README.md", "readme.md", "Readme.md"].find((f) => existsSync(join(root, f))) ?? "README.md";
}

async function build(root, { serve = false } = {}) {
  const theme = await readText(themePath);
  const git = await gitInfo(root);
  const manifest = await loadManifest(root);
  const ext = manifest?.readme_site || {};
  // --- i18n: page.md is the default locale; page.<locale>.md is a translation twin.
  // Configure via manifest.readme_site.i18n = { defaultLocale, locales: [{code,label}] }.
  const i18n = ext.i18n || {};
  const defaultLocale = i18n.defaultLocale || "en-UK";
  const localeList = (Array.isArray(i18n.locales) && i18n.locales.length)
    ? i18n.locales
    : [{ code: defaultLocale, label: "English" }];
  const altLocales = localeList.map((l) => l.code).filter((c) => c !== defaultLocale);
  const altRe = altLocales.length
    ? new RegExp(`\\.(${altLocales.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\.md$`, "i")
    : null;
  const localeInfo = (mdRel) => {
    if (altRe) { const m = mdRel.match(altRe); if (m) return { locale: m[1], baseRel: mdRel.replace(altRe, ".md") }; }
    return { locale: defaultLocale, baseRel: mdRel };
  };
  const cfg = { title: manifest?.name || manifest?.short_name, description: manifest?.description, logo: manifest ? pickIcon(manifest.icons) : null, logoDark: ext.logo_dark || null };
  const base = baseUrl || ext.baseUrl?.replace(/\/$/, "") || null;
  const override = manifest ? await manifestCss(manifest, ext, root) : "";

  const queue = (seeds.length ? seeds : [detectReadme(root)]).map((s) => posix.normalize(s));
  const seen = new Set(), assets = new Set(), pages = [];
  while (queue.length) {
    const mdRel = posix.normalize(queue.shift());
    if (seen.has(mdRel)) continue;
    seen.add(mdRel);
    const abs = join(root, mdRel);
    if (!existsSync(abs)) { console.warn(`  missing: ${mdRel}`); continue; }
    pages.push({ mdRel, ...(await renderMd(await readText(abs), mdRel, queue, seen, assets)) });
  }
  // i18n expansion: every page reachable in the default locale may have <name>.<locale>.md
  // twins sitting beside it. Pull them in even though nothing links to them, so a translated
  // page is reachable purely by existing as a twin of a discovered default-locale page.
  if (altLocales.length) {
    const have = new Set(pages.map((p) => p.mdRel));
    for (const pg of [...pages]) {
      if (localeInfo(pg.mdRel).locale !== defaultLocale) continue;
      for (const loc of altLocales) {
        const variantRel = pg.mdRel.replace(/\.md$/i, `.${loc}.md`);
        if (have.has(variantRel)) continue;
        const abs = join(root, variantRel);
        if (!existsSync(abs)) continue;
        have.add(variantRel);
        // throwaway queue/seen: a translated page's links are rewritten to .html, but we do
        // not crawl onward from it - its twins are found via this same sibling sweep.
        pages.push({ mdRel: variantRel, ...(await renderMd(await readText(abs), variantRel, [], new Set(), assets)) });
      }
    }
  }
  if (!pages.length) throw new Error("no pages - is there a README.md?");

  if (!pages.some((p) => outName(p.mdRel) === "index.html")) pages[0].asIndex = true;
  const siteTitle = cfg.title || (pages.find((p) => p.asIndex || outName(p.mdRel) === "index.html") ?? pages[0]).title;

  for (const pg of pages) {
    const li = localeInfo(pg.mdRel);
    pg.locale = li.locale;
    pg.baseRel = li.baseRel;
    const baseOut = pg.asIndex ? "index.html" : outName(li.baseRel);
    pg.outRel = pg.locale === defaultLocale ? baseOut : baseOut.replace(/\.html$/i, `.${pg.locale}.html`);
    pg.isIndex = pg.outRel === "index.html";
    pg.depth = pg.outRel.split("/").length - 1;
    pg.twinRel = pg.outRel.replace(/\.html$/, ".md");
    pg.twin = posix.basename(pg.twinRel);
    pg.logo = cfg.logo ? "../".repeat(pg.depth) + cfg.logo : null;
    pg.logoDark = cfg.logoDark ? "../".repeat(pg.depth) + cfg.logoDark : null;
    if (pg.isIndex && cfg.description) pg.tagline = cfg.description;
    pg.ogFile = pg.isIndex ? "og.png" : posix.basename(pg.outRel).replace(/\.html$/, ".og.png");
    pg.makeOg = !serve && (base || pg.isIndex);
    pg.og = pg.makeOg ? (base ? `${base}/${posix.dirname(pg.outRel) === "." ? "" : posix.dirname(pg.outRel) + "/"}${pg.ogFile}` : pg.ogFile) : null;
    pg.canonical = base ? `${base}/${pg.isIndex ? "" : pg.outRel}` : null;
    pg.editUrl = git ? `${git.blob}/${pg.mdRel}` : null;
    pg.updated = git ? await commitInfo(root, pg.mdRel, git, ["-1"]) : null;
    pg.created = git ? await commitInfo(root, pg.mdRel, git, ["--reverse"]) : null;
  }

  // i18n wiring: which output file is this page in each locale, and where is each locale's home?
  const byBaseLocale = new Map(); // baseRel -> Map(locale -> outRel)
  for (const pg of pages) {
    if (!byBaseLocale.has(pg.baseRel)) byBaseLocale.set(pg.baseRel, new Map());
    byBaseLocale.get(pg.baseRel).set(pg.locale, pg.outRel);
  }
  const localeHome = {};
  for (const code of localeList.map((l) => l.code))
    localeHome[code] = code === defaultLocale ? "index.html" : (pages.find((p) => p.outRel === `index.${code}.html`)?.outRel ?? "index.html");
  const switcherFor = (pg) => {
    if (localeList.length < 2) return "";
    const prefix = "../".repeat(pg.depth);
    const items = localeList.map((L) => {
      const out = byBaseLocale.get(pg.baseRel)?.get(L.code) ?? localeHome[L.code];
      const label = esc(L.label || L.code);
      return L.code === pg.locale
        ? `<span class="lang current" aria-current="page" lang="${esc(L.code)}">${label}</span>`
        : `<a class="lang" href="${esc(prefix + out)}" hreflang="${esc(L.code)}" lang="${esc(L.code)}">${label}</a>`;
    }).join("");
    return `<nav class="langswitch" aria-label="Language">${items}</nav>`;
  };
  const hreflangFor = (pg) => {
    if (localeList.length < 2 || !base) return "";
    const tags = [];
    for (const L of localeList) {
      const out = byBaseLocale.get(pg.baseRel)?.get(L.code);
      if (!out) continue;
      const url = `${base}/${out === "index.html" ? "" : out}`;
      tags.push(`<link rel="alternate" hreflang="${esc(L.code)}" href="${esc(url)}" />`);
    }
    const def = byBaseLocale.get(pg.baseRel)?.get(defaultLocale);
    if (def) tags.push(`<link rel="alternate" hreflang="x-default" href="${esc(`${base}/${def === "index.html" ? "" : def}`)}" />`);
    return tags.length ? "\n    " + tags.join("\n    ") + "\n    " : "";
  };

  // breadcrumb: each directory's index page is its "up one level" target, so a deep page
  // links Home > Section > Parent instead of jumping straight to the site root.
  const dirIndex = new Map(); // `${dir}|${locale}` -> { outRel, title }
  for (const pg of pages) {
    const bn = posix.basename(pg.outRel);
    if (bn === "index.html" || /^index\.[\w-]+\.html$/.test(bn))
      dirIndex.set(`${posix.dirname(pg.outRel)}|${pg.locale}`, { outRel: pg.outRel, title: pg.title });
  }
  const crumbsFor = (pg) => {
    const prefix = "../".repeat(pg.depth);
    const dir = posix.dirname(pg.outRel);
    const segs = dir === "." ? [] : dir.split("/");
    const dirs = ["."];
    for (let i = 0; i < segs.length; i++) dirs.push(segs.slice(0, i + 1).join("/"));
    const crumbs = [];
    for (const d of dirs) {
      const idx = dirIndex.get(`${d}|${pg.locale}`) ?? dirIndex.get(`${d}|${defaultLocale}`);
      if (idx && idx.outRel !== pg.outRel) crumbs.push(idx);
    }
    if (!crumbs.length) return "";
    const link = (c) => `<a href="${esc(prefix + c.outRel)}">${esc(c.title)}</a>`;
    const sep = '<span class="sep" aria-hidden="true">›</span>';
    let inner;
    if (crumbs.length <= 3) {
      // up to one middle level: show the whole trail - folding a single item is pointless
      inner = crumbs.map(link).join(sep);
    } else {
      // two or more middle levels: fold them into a "…" disclosure, keeping first + last
      const middle = crumbs.slice(1, -1);
      const menu = `<details class="crumb-more"><summary aria-label="Show ${middle.length} more level${middle.length === 1 ? "" : "s"}">…</summary><div class="crumb-menu">${middle.map(link).join("")}</div></details>`;
      inner = link(crumbs[0]) + sep + menu + sep + link(crumbs[crumbs.length - 1]);
    }
    return `<nav class="crumbs" aria-label="Breadcrumb">${inner}</nav>`;
  };

  // site-graph data (default-locale pages). Embedded in every page so the viewer works even
  // when the page is opened straight from disk (file://), where fetch() is blocked.
  const graphPages = pages.filter((p) => p.locale === defaultLocale);
  const byMdG = new Map(graphPages.map((p) => [p.mdRel, p]));
  const gnodes = graphPages.map((p) => ({ id: p.outRel, t: p.title, d: firstPara(p.src) || ogTagline(p.tagline || ""), home: !!p.isIndex }));
  const gseen = new Set(), glinks = [];
  for (const p of graphPages) for (const tgt of (p.outLinks || [])) {
    const tp = byMdG.get(posix.normalize(tgt));
    if (!tp || tp.outRel === p.outRel) continue;
    const k = `${p.outRel}|${tp.outRel}`; if (gseen.has(k)) continue; gseen.add(k);
    glinks.push({ s: p.outRel, t: tp.outRel });
  }
  const graphJson = JSON.stringify({ nodes: gnodes, links: glinks });
  await write(join(outDir, "graph.json"), graphJson);
  // Related pages remain a normal, accessible list. Explicit forward links keep their
  // authored order; backlinks fill in additional context without duplicating entries.
  for (const p of graphPages) {
    const seen = new Set([p.outRel]), related = [];
    const add = (target) => { if (!target || seen.has(target.outRel)) return; seen.add(target.outRel); related.push(target); };
    for (const target of (p.outLinks || [])) add(byMdG.get(posix.normalize(target)));
    for (const source of graphPages) if ((source.outLinks || new Set()).has(p.mdRel)) add(source);
    const groups = new Map();
    for (const target of related.slice(0, 12)) {
      const label = topLevelSection(target.outRel);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push({ id: target.outRel, title: target.title });
    }
    p.relatedPages = [...groups].map(([label, groupPages]) => ({ label, pages: groupPages }));
  }
  // search index (served via dist; MiniSearch builds from it client-side)
  const searchDocs = graphPages.map((p) => ({ id: p.outRel, t: p.title, k: docHeadings(p.src), x: docText(p.src, 5000), d: firstPara(p.src) || ogTagline(p.tagline || ""), s: docSection(p.outRel), h: docHeadingsAnchored(p.src) }));
  await write(join(outDir, "search-index.json"), JSON.stringify(searchDocs));

  // giscus comments: opt-in via manifest.readme_site.comments; theme auto-derived from brand colours
  const commentsCfg = ext.comments && ext.comments.repo ? ext.comments : null;
  let commentsOut = null;
  if (commentsCfg) {
    // an absolute `comments.themeUrl` wins (point it at any public HTTPS + CORS file).
    const override = /^https?:\/\//.test(commentsCfg.themeUrl || "") ? commentsCfg.themeUrl : null;
    // only build the brand theme when the manifest actually carries theme colours; otherwise
    // let giscus use its own. The generated sheet @imports the shared base from the repo and
    // adds the palette - giscus fetches it cross-origin, so the host must send CORS (the dev
    // server does). Cache-bust on content so a changed theme is re-fetched.
    const hasTheme = !!(manifest && (manifest.theme_color || manifest.background_color || ext.fg || ext.dark));
    let themeUrl = "preferred_color_scheme";
    if (override) themeUrl = override;
    else if (base && hasTheme) {
      const giscusCss = giscusTheme(manifest);
      await write(join(outDir, "giscus-theme.css"), giscusCss);
      let h = 5381; for (let i = 0; i < giscusCss.length; i++) h = ((h * 33) ^ giscusCss.charCodeAt(i)) >>> 0;
      themeUrl = base + "/giscus-theme.css?v=" + h.toString(36);
    }
    commentsOut = { ...commentsCfg, themeUrl };
  }

  for (const pg of pages) {
    await write(join(outDir, pg.outRel), pageHtml({ ...pg, theme, extraCss: override, siteTitle, themeColor: manifest?.background_color, themeColorDark: ext.dark?.bg, hasManifest: !!manifest, lang: pg.locale, langSwitch: switcherFor(pg), hreflang: hreflangFor(pg), nav: crumbsFor(pg), isHome: pg.outRel === localeHome[pg.locale], graphJson, comments: commentsOut, showGeneratorAttribution, showFooterActions, showRelatedPages }));
    await write(join(outDir, pg.twinRel), pg.src.replace(/(\]\([^)]*?)README\.md/gi, "$1index.md"));
  }
  let copied = 0;
  for (const a of assets) {
    const from = join(root, a);
    if (existsSync(from)) { await copy(from, join(outDir, a)); copied++; }
    else console.warn(`  missing asset: ${a}`);
  }
  if (cfg.logo && existsSync(join(root, cfg.logo))) await copy(join(root, cfg.logo), join(outDir, cfg.logo));
  if (cfg.logoDark && existsSync(join(root, cfg.logoDark))) await copy(join(root, cfg.logoDark), join(outDir, cfg.logoDark));
  if (manifest) await copy(manifest.__path, join(outDir, "manifest.json"));
  for (const f of ["lexend-400.woff2", "lexend-700.woff2", "lexend-OFL.txt"])
    await copy(font(f), join(outDir, "fonts", f));
  // vendored d3-force engine (loaded via <script src> so it works from file:// too)
  await copy(join(here, "vendor", "d3-force.bundle.js"), join(outDir, "d3-force.js"));
  await copy(join(here, "vendor", "minisearch.min.js"), join(outDir, "minisearch.min.js"));
  // mermaid is heavy (~3.5MB), so it ships only when a page actually has a
  // ```mermaid fence - and each page only loads it when it needs it.
  if (pages.some((p) => p.hasMermaid))
    await copy(join(here, "vendor", "mermaid.min.js"), join(outDir, "mermaid.min.js"));

  const ogPages = pages.filter((p) => p.makeOg);
  if (ogPages.length) {
    try {
      const vars = {};
      for (const m of theme.matchAll(/--(bg|fg|accent):\s*([^;]+);/g)) vars[m[1]] ??= m[2].trim();
      if (manifest?.background_color) vars.bg = manifest.background_color;
      if (manifest?.theme_color) vars.accent = manifest.theme_color;
      if (ext.fg) vars.fg = ext.fg;
      const regular = await Bun.file(font("lexend-400.woff")).arrayBuffer();
      const bold = await Bun.file(font("lexend-700.woff")).arrayBuffer();
      for (const pg of ogPages) {
        const png = await makeOgPng({ title: pg.title, tagline: ogTagline(pg.tagline || pg.title), regular, bold, bg: vars.bg, fg: vars.fg, accent: vars.accent });
        await write(join(outDir, posix.dirname(pg.outRel), pg.ogFile), png);
      }
    } catch (e) { console.warn(`  og: skipped - ${e.message}`); }
  }

  if (base) {
    const urls = pages.map((p) => `  <url><loc>${base}/${p.isIndex ? "" : p.outRel}</loc></url>`).join("\n");
    await write(join(outDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
    await write(join(outDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
    const idx = pages.find((p) => p.isIndex) ?? pages[0];
    const docs = pages.map((p) => `- [${p.title}](${base}/${p.twinRel}): ${ogTagline(p.tagline || p.title)}`).join("\n");
    await write(join(outDir, "llms.txt"), `# ${idx.title}\n\n> ${idx.tagline}\n\n## Docs\n\n${docs}\n`);
    await write(join(outDir, "llms-full.txt"), pages.map((p) => p.src).join("\n\n---\n\n") + "\n");
  }
  return { pages: pages.length, assets: copied };
}

// mtime signature of source files - the reload trigger, polled by the client.
// Never includes the output dir: it is rewritten on every build, so watching it
// (when it sits inside the source root, e.g. docs/_site) would reload endlessly.
function sourceSig(root) {
  let s = 0;
  const r = relative(root, outDir).replace(/\\/g, "/");
  const inOut = r && r !== ".." && !r.startsWith("../") && !r.startsWith("/") ? r : null;
  try { s += statSync(themePath).mtimeMs; } catch {}
  try { if (manifestArg) s += statSync(resolve(root, manifestArg)).mtimeMs; } catch {}
  try {
    for (const f of readdirSync(root, { recursive: true })) {
      if (typeof f !== "string") continue;
      const nf = f.replace(/\\/g, "/");
      if (inOut && (nf === inOut || nf.startsWith(inOut + "/"))) continue;
      if (/\.(md|json|css|png|jpe?g|svg)$/i.test(f) && !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(f)) {
        try { s += statSync(join(root, f)).mtimeMs; } catch {}
      }
    }
  } catch {}
  return Math.round(s);
}

const root = await resolveRoot();

if (argv.includes("--serve")) {
  let building = false, builtSig = null;
  // rebuild only when the source signature actually changes - not on every request
  const ensureFresh = async () => {
    if (building) return;
    const sig = sourceSig(root);
    if (sig === builtSig) return;
    building = true;
    try { await build(root, { serve: true }); builtSig = sig; }
    catch (e) { console.warn(`build: ${e.message}`); }
    finally { building = false; }
  };
  await ensureFresh();
  const reload = `<script>let v=null;setInterval(async()=>{const n=await(await fetch("/__v")).text();if(v===null)v=n;else if(n!==v)location.reload()},400)</script>`;
  const server = Bun.serve({
    port,
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      if (p === "/__v") return new Response(String(sourceSig(root)));
      const rel = p === "/" || p.endsWith("/") ? p.replace(/^\//, "") + "index.html" : p.replace(/^\//, "");
      const isHtml = rel.endsWith(".html");
      if (isHtml) await ensureFresh();
      const file = Bun.file(join(outDir, rel));
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      // CORS on every response: giscus fetches giscus-theme.css cross-origin from
      // giscus.app and needs Access-Control-Allow-Origin, else it silently falls back
      // to its default theme. (Production hosting must send this header too.)
      const cors = { "access-control-allow-origin": "*" };
      if (isHtml) return new Response((await file.text()).replace("</body>", reload + "</body>"), { headers: { "content-type": "text/html", ...cors } });
      return new Response(file, { headers: cors });
    },
  });
  console.log(`live preview: ${server.url} (edit any file, the page reloads)`);
} else {
  const r = await build(root);
  console.log(`done: ${outDir} (${r.pages} pages, ${r.assets} assets)`);
}
