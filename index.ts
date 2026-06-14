#!/usr/bin/env bun
// folder2website - render a repo's README (and every .md it links to), or any
// folder of markdown (a Notion/Obsidian export, a skills dir), as a clean,
// self-contained static site. Bun-native. No config, no frontmatter.
//
//   folder2website <path-or-repo> [--out <dir>] [--token <T>] [--entry f.md ...]
//                                 [--base-url https://...] [--serve]
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
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, posix, extname } from "node:path";
import { tmpdir } from "node:os";
import { makeOgPng } from "./og.ts";

const argv = process.argv.slice(2);
const usage = "usage: folder2website <path-or-repo> [--out <dir>] [--token <T>] [--entry f.md ...] [--base-url <url>] [--serve]";
if (argv.includes("-h") || argv.includes("--help")) {
  console.log(usage);
  process.exit(0);
}
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const flags = new Set(["--out", "--token", "--entry", "--base-url"]);
const target = argv.filter((a, i) => !a.startsWith("-") && !flags.has(argv[i - 1]))[0];
if (!target) {
  console.error(usage);
  process.exit(1);
}
const token = flag("--token") ?? process.env.GITHUB_TOKEN;
const outDir = resolve(flag("--out") ?? "site");
const baseUrl = flag("--base-url")?.replace(/\/$/, "");
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
const isLocal = (h) => h && !/^[a-z][a-z0-9+.-]*:/i.test(h) && !h.startsWith("//") && !h.startsWith("/") && !h.startsWith("#");
const outName = (rel) => rel.replace(/\.md$/i, ".html").replace(/(^|\/)(readme)\.html$/i, "$1index.html");
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
  const dest = join(tmpdir(), "folder2website-clone", target.replace(/[^\w.-]+/g, "_"));
  await $`rm -rf ${dest}`.quiet();
  console.log(`cloning ${target} ...`);
  await $`git clone --depth 1 ${auth} ${dest}`.quiet();
  return dest;
}

async function gitInfo(root) {
  const remote = await gitOut(["-C", root, "config", "--get", "remote.origin.url"]);
  const m = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!m) return null;
  const branch = (await gitOut(["-C", root, "rev-parse", "--abbrev-ref", "HEAD"])) || "main";
  return { blob: `https://github.com/${m[1]}/blob/${branch}` };
}
const lastUpdated = (root, f) => gitOut(["-C", root, "log", "-1", "--format=%cs", "--", f]);
const firstCommit = async (root, f) => (await gitOut(["-C", root, "log", "--reverse", "--format=%cs", "--", f])).split("\n")[0] || "";

async function loadManifest(root) {
  const p = join(root, "manifest.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(await readText(p)); }
  catch (e) { console.warn(`  manifest.json ignored: ${e.message}`); return null; }
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

async function renderMd(src, mdRel, queue, seen, assets, { skipLogo = false } = {}) {
  src = src.trim();
  const title = src.match(/^#\s+(.+)$/m)?.[1].trim() ?? posix.basename(mdRel);
  const tagline = src.split(/\n\s*\n/).map((b) => b.trim())
    .find((b) => b && !b.startsWith("#") && !b.startsWith("!["))?.replace(/\s+/g, " ") || "";

  let body = await marked.parse(src);
  // ponytail: regexes over marked's own output (controlled input)
  if (!skipLogo) body = body.replace(/^\s*<p>\s*(<img )([^>]*>)\s*<\/p>/, '$1class="logo" $2');
  body = body.replace(/<p>((?:\s*<img[^>]*>\s*)+)<\/p>/g, (_m, imgs) =>
    `<div class="${(imgs.match(/<img/g) || []).length > 3 ? "shots" : "imgrow"}">${imgs}</div>`);
  body = body.replace("<p>", '<p class="tagline">');
  ({ body } = enrichHeadings(body));

  for (const m of body.matchAll(/<img[^>]*\bsrc="([^"]+)"/g))
    if (isLocal(m[1])) { const a = relAsset(mdRel, m[1]); if (a) assets.add(a); }
  body = body.replace(/(<a[^>]*\bhref=")([^"]+)(")/g, (full, a, href, b) => {
    if (!isLocal(href)) return full;
    const t = relAsset(mdRel, href);
    if (!t) return full;
    if (extname(href.split("#")[0]).toLowerCase() === ".md") {
      if (!seen.has(t)) queue.push(t);
      return a + outName(href) + b;
    }
    assets.add(t);
    return full;
  });
  return { title, tagline, body, src };
}

function pageHtml({ title, tagline, body, theme, extraCss, depth, og, canonical, isIndex, siteTitle, logo, editUrl, updated, created, twin, themeColor, themeColorDark, hasManifest }) {
  const prefix = "../".repeat(depth);
  const css = theme.replace(/url\("fonts\//g, `url("${prefix}fonts/`) + (extraCss || "");
  const favicon = logo || body.match(/<img[^>]*\bsrc="([^"]+)"/)?.[1];
  const icon = favicon ? `<link rel="icon" href="${esc(favicon)}"${favicon.endsWith(".svg") ? ' type="image/svg+xml"' : ""} />\n    ` : "";
  const ogTags = og ? `<meta property="og:image" content="${esc(og)}" />\n    <meta name="twitter:card" content="summary_large_image" />\n    ` : "";
  const canon = canonical ? `<link rel="canonical" href="${esc(canonical)}" />\n    ` : "";
  const tc = themeColor
    ? `<meta name="theme-color" content="${esc(themeColor)}"${themeColorDark ? ' media="(prefers-color-scheme: light)"' : ""} />\n    ${themeColorDark ? `<meta name="theme-color" content="${esc(themeColorDark)}" media="(prefers-color-scheme: dark)" />\n    ` : ""}`
    : "";
  const mani = hasManifest ? `<link rel="manifest" href="${prefix}manifest.json" />\n    ` : "";
  const heroLogo = isIndex && logo ? `<img class="logo" src="${esc(logo)}" width="84" height="84" alt="${esc(siteTitle)} logo" />\n      ` : "";
  const home = !isIndex ? `<a class="home" href="${prefix}index.html">← ${esc(siteTitle)}</a>\n      ` : "";
  const gitLink = editUrl ? ` · <a href="${esc(editUrl)}">Edit on GitHub</a>` : "";
  const dates = [updated ? `Updated ${updated}` : "", created && created !== updated ? `Created ${created}` : ""].filter(Boolean).join(" · ");
  const meta = `\n      <footer class="meta"><button class="linkish copy-md" data-md="${esc(twin)}">Copy as Markdown</button>${gitLink}${dates ? " · " + dates : ""}</footer>`;
  const script = `<script>for(const b of document.querySelectorAll(".copy-md"))b.onclick=async()=>{await navigator.clipboard.writeText(await(await fetch(b.dataset.md)).text());const o=b.textContent;b.textContent="Copied";setTimeout(()=>b.textContent=o,900)};for(const p of document.querySelectorAll("pre.shiki")){const b=document.createElement("button");b.className="copy-code";b.textContent="Copy";b.onclick=async()=>{await navigator.clipboard.writeText(p.querySelector("code")?.innerText??p.innerText);const o=b.textContent;b.textContent="Copied";setTimeout(()=>b.textContent=o,900)};p.appendChild(b)};(()=>{const c={};let pop;async function load(h){if(c[h])return c[h];try{const d=new DOMParser().parseFromString(await(await fetch(h)).text(),"text/html");return c[h]={t:(d.querySelector("h1")?.textContent||d.title||"").trim(),d:(d.querySelector(".tagline")?.textContent||"").trim()}}catch{return c[h]={t:"",d:""}}}for(const a of document.querySelectorAll('.wrap a[href$=".html"],.wrap a.home')){let tm;a.addEventListener("mouseenter",()=>{tm=setTimeout(async()=>{const{t,d}=await load(a.href);if(!t)return;pop?.remove();pop=document.createElement("div");pop.className="popover";const s=document.createElement("strong");s.textContent=t;pop.appendChild(s);if(d){const x=document.createElement("span");x.textContent=d;pop.appendChild(x)}document.body.appendChild(pop);const r=a.getBoundingClientRect();pop.style.left=Math.min(scrollX+r.left,scrollX+innerWidth-pop.offsetWidth-12)+"px";pop.style.top=(scrollY+r.bottom+8)+"px"},180)});a.addEventListener("mouseleave",()=>{clearTimeout(tm);pop?.remove();pop=null})}})()</script>`;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(tagline)}" />
    ${canon}${tc}${mani}${icon}<meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(tagline)}" />
    ${ogTags}<style>
${css}
    </style>
  </head>
  <body>
    <main class="wrap">
      ${home}${heroLogo}${body}${meta}
    </main>
    ${script}
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
  const cfg = { title: manifest?.name || manifest?.short_name, description: manifest?.description, logo: manifest ? pickIcon(manifest.icons) : null };
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
    pages.push({ mdRel, ...(await renderMd(await readText(abs), mdRel, queue, seen, assets, { skipLogo: !!cfg.logo })) });
  }
  if (!pages.length) throw new Error("no pages - is there a README.md?");

  if (!pages.some((p) => outName(p.mdRel) === "index.html")) pages[0].asIndex = true;
  const siteTitle = cfg.title || (pages.find((p) => p.asIndex || outName(p.mdRel) === "index.html") ?? pages[0]).title;

  for (const pg of pages) {
    pg.outRel = pg.asIndex ? "index.html" : outName(pg.mdRel);
    pg.isIndex = pg.outRel === "index.html";
    pg.depth = pg.outRel.split("/").length - 1;
    pg.twinRel = pg.outRel.replace(/\.html$/, ".md");
    pg.twin = posix.basename(pg.twinRel);
    pg.logo = cfg.logo ? "../".repeat(pg.depth) + cfg.logo : null;
    if (pg.isIndex && cfg.description) pg.tagline = cfg.description;
    pg.ogFile = pg.isIndex ? "og.png" : posix.basename(pg.outRel).replace(/\.html$/, ".og.png");
    pg.makeOg = !serve && (base || pg.isIndex);
    pg.og = pg.makeOg ? (base ? `${base}/${posix.dirname(pg.outRel) === "." ? "" : posix.dirname(pg.outRel) + "/"}${pg.ogFile}` : pg.ogFile) : null;
    pg.canonical = base ? `${base}/${pg.isIndex ? "" : pg.outRel}` : null;
    pg.editUrl = git ? `${git.blob}/${pg.mdRel}` : null;
    pg.updated = git ? await lastUpdated(root, pg.mdRel) : "";
    pg.created = git ? await firstCommit(root, pg.mdRel) : "";
  }
  for (const pg of pages) {
    await write(join(outDir, pg.outRel), pageHtml({ ...pg, theme, extraCss: override, siteTitle, themeColor: manifest?.background_color, themeColorDark: ext.dark?.bg, hasManifest: !!manifest }));
    await write(join(outDir, pg.twinRel), pg.src.replace(/(\]\([^)]*?)README\.md/gi, "$1index.md"));
  }
  let copied = 0;
  for (const a of assets) {
    const from = join(root, a);
    if (existsSync(from)) { await copy(from, join(outDir, a)); copied++; }
    else console.warn(`  missing asset: ${a}`);
  }
  if (cfg.logo && existsSync(join(root, cfg.logo))) await copy(join(root, cfg.logo), join(outDir, cfg.logo));
  if (manifest) await copy(join(root, "manifest.json"), join(outDir, "manifest.json"));
  for (const f of ["lexend-400.woff2", "lexend-700.woff2", "lexend-OFL.txt"])
    await copy(font(f), join(outDir, "fonts", f));

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

// mtime signature of source files - the reload trigger, polled by the client
function sourceSig(root) {
  let s = 0;
  try { s += statSync(themePath).mtimeMs; } catch {}
  try {
    for (const f of readdirSync(root, { recursive: true })) {
      if (typeof f === "string" && /\.(md|json|css|png|jpe?g|svg)$/i.test(f) && !/(^|[\\/])(node_modules|\.git|site)([\\/]|$)/.test(f)) {
        try { s += statSync(join(root, f)).mtimeMs; } catch {}
      }
    }
  } catch {}
  return Math.round(s);
}

const root = await resolveRoot();

if (argv.includes("--serve")) {
  let building = false;
  const ensureFresh = async () => {
    if (building) return;
    building = true;
    try { await build(root, { serve: true }); } catch (e) { console.warn(`build: ${e.message}`); }
    building = false;
  };
  await ensureFresh();
  const reload = `<script>let v=null;setInterval(async()=>{const n=await(await fetch("/__v")).text();if(v===null)v=n;else if(n!==v)location.reload()},400)</script>`;
  const server = Bun.serve({
    port: 4321,
    async fetch(req) {
      const p = decodeURIComponent(new URL(req.url).pathname);
      if (p === "/__v") return new Response(String(sourceSig(root)));
      const rel = p === "/" || p.endsWith("/") ? p.replace(/^\//, "") + "index.html" : p.replace(/^\//, "");
      const isHtml = rel.endsWith(".html");
      if (isHtml) await ensureFresh();
      const file = Bun.file(join(outDir, rel));
      if (!(await file.exists())) return new Response("not found", { status: 404 });
      if (isHtml) return new Response((await file.text()).replace("</body>", reload + "</body>"), { headers: { "content-type": "text/html" } });
      return new Response(file);
    },
  });
  console.log(`live preview: ${server.url} (edit any file, the page reloads)`);
} else {
  const r = await build(root);
  console.log(`done: ${outDir} (${r.pages} pages, ${r.assets} assets)`);
}
