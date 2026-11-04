// Checks for what an author or a coding agent can fix in the source folder: links that lead
// nowhere, anchors no heading carries, files nothing links to, and heading or fence slips.
// Each finding names a file, line and column in the markdown, so an agent can act on it
// without reading the built site. Findings never stop a build; `--check` exits 1 on errors.
import { readdirSync } from "node:fs";
import { join, posix, relative } from "node:path";

export type Severity = "error" | "warn";
export type Diagnostic = { code: string; severity: Severity; message: string; file: string; line: number; column: number; fix?: { description: string } };

export function createDiagnostics() {
  const list: Diagnostic[] = [];
  const report = (d: Omit<Diagnostic, "line" | "column"> & { line?: number; column?: number }) =>
    list.push({ line: 1, column: 1, ...d, code: `f2w/${d.code}` } as Diagnostic);
  return { list, report };
}

// Line and column of the nth occurrence of a needle in the source, 1-based.
export function locate(src: string, needle: string, nth = 0) {
  let i = -1;
  for (let k = 0; k <= nth; k++) { i = src.indexOf(needle, i + 1); if (i < 0) break; }
  if (i < 0 && nth > 0) i = src.indexOf(needle);
  if (i < 0) return { line: 1, column: 1 };
  const before = src.slice(0, i).split("\n");
  return { line: before.length, column: before[before.length - 1].length + 1 };
}

const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

function levenshtein(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}
export function suggest(wanted: string, options: Iterable<string>) {
  let best = "", bestD = Infinity;
  for (const o of options) { const d = levenshtein(wanted.toLowerCase(), o.toLowerCase()); if (d < bestD) { best = o; bestD = d; } }
  return best && bestD <= Math.max(2, Math.floor(wanted.length / 3)) ? best : "";
}

// Every markdown file under the root that a build could have reached. Hidden folders,
// `_`-prefixed folders (authoring notes, as in Jekyll), dependencies and the output folder
// are not site content.
export function markdownFiles(root: string, outDir: string) {
  const out = relative(root, outDir).replace(/\\/g, "/");
  const inOut = out && !out.startsWith("..") && !out.startsWith("/") ? out : null;
  const files: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync(root, { recursive: true }) as string[]; } catch { return files; }
  for (const f of entries) {
    if (typeof f !== "string") continue;
    const rel = f.replace(/\\/g, "/");
    if (!/\.md$/i.test(rel)) continue;
    if (rel.split("/").slice(0, -1).some((seg) => seg.startsWith(".") || seg.startsWith("_") || seg === "node_modules")) continue;
    if (inOut && (rel === inOut || rel.startsWith(inOut + "/"))) continue;
    files.push(rel);
  }
  return files.sort();
}

// Heading levels and fences, read from the markdown itself. Fenced code is skipped so a
// `# comment` in a shell block is not a heading.
export function lintMarkdown(raw: string, file: string, report: ReturnType<typeof createDiagnostics>["report"]) {
  const lines = raw.split(/\r?\n/);
  let fence: string | null = null, h1s = 0, prevLevel = 0;
  let start = 0;
  if (/^---\r?\n/.test(raw)) { const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---"); if (end > 0) start = end + 1; }
  for (let i = start; i < lines.length; i++) {
    const ln = lines[i];
    const f = ln.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
    if (f) {
      if (!fence) {
        fence = f[1];
        if (!f[2]) report({ code: "code-block-lang", severity: "warn", file, line: i + 1, column: 1, message: "code block has no language", fix: { description: "name the language after the opening fence, or `text` for plain output" } });
      } else if (f[1][0] === fence[0] && f[1].length >= fence.length && !f[2]) fence = null;
      continue;
    }
    if (fence) continue;
    const h = ln.match(/^\s{0,3}(#{1,6})\s+\S/);
    if (!h) continue;
    const level = h[1].length;
    if (level === 1 && ++h1s > 1) report({ code: "single-h1", severity: "warn", file, line: i + 1, column: 1, message: "more than one top-level heading; the first one is the page title", fix: { description: "make this an H2" } });
    if (prevLevel && level > prevLevel + 1) report({ code: "heading-hierarchy", severity: "warn", file, line: i + 1, column: 1, message: `heading jumps from H${prevLevel} to H${level}`, fix: { description: `use H${prevLevel + 1}` } });
    prevLevel = level;
  }
}

type Ref = { href: string; target: string | null; kind: "page" | "asset" | "anchor" };
type CheckedPage = { mdRel: string; raw: string; refs: Ref[]; ids: Set<string> };

// Links are judged from what the renderer produced, so the check never disagrees with the
// site; the source is only searched to place each finding on a line.
export function checkLinks(pages: CheckedPage[], exists: (rel: string) => boolean, allMd: string[], report: ReturnType<typeof createDiagnostics>["report"]) {
  const byRel = new Map(pages.map((p) => [p.mdRel, p]));
  for (const p of pages) {
    const seen = new Map<string, number>();
    for (const r of p.refs) {
      const raw = unescape(r.href);
      const nth = seen.get(raw) ?? 0; seen.set(raw, nth + 1);
      const at = locate(p.raw, raw, nth);
      const [path, frag] = raw.split("#");
      if (r.kind !== "anchor" && r.target === null) {
        report({ code: "outside-folder", severity: "warn", file: p.mdRel, ...at, message: `"${raw}" points outside the folder being built; it works only where the server has that path beside this site` });
        continue;
      }
      if (r.kind === "page" && !exists(r.target!)) {
        const near = suggest(r.target!, allMd);
        const hint = near ? posix.relative(posix.dirname(p.mdRel), near) : "";
        report({ code: "broken-link", severity: "error", file: p.mdRel, ...at, message: `"${path}" does not exist`, ...(hint ? { fix: { description: `did you mean "${hint}"?` } } : {}) });
        continue;
      }
      if (r.kind === "asset" && !exists(r.target!)) {
        report({ code: "missing-asset", severity: "error", file: p.mdRel, ...at, message: `"${path}" does not exist, so the site ships without it` });
        continue;
      }
      if (!frag) continue;
      const dest = r.kind === "anchor" ? p : byRel.get(r.target!);
      if (!dest) continue;
      const id = safeDecode(frag);
      if (dest.ids.has(id)) continue;
      const near = suggest(id, dest.ids);
      report({ code: "broken-anchor", severity: "error", file: p.mdRel, ...at, message: `"#${id}" is not a section of ${dest === p ? "this page" : dest.mdRel}`, fix: { description: near ? `did you mean "#${near}"? Only H2 and H3 headings get anchors` : "only H2 and H3 headings get anchors" } });
    }
  }
}

export function unlinkedFiles(allMd: string[], reached: Set<string>, isTranslation: (rel: string) => boolean, report: ReturnType<typeof createDiagnostics>["report"]) {
  for (const f of allMd) {
    if (reached.has(f) || isTranslation(f)) continue;
    report({ code: "unlinked-file", severity: "warn", file: f, message: "no page links here, so it is not on the site", fix: { description: "link it from a page, or delete it" } });
  }
}

export function summarize(list: Diagnostic[]) {
  const errors = list.filter((d) => d.severity === "error").length;
  return { errors, warnings: list.length - errors, total: list.length, files: new Set(list.map((d) => d.file)).size };
}

const order = (a: Diagnostic, b: Diagnostic) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column;

export function formatPretty(list: Diagnostic[]) {
  const s = summarize(list);
  if (!s.total) return "check: clean";
  const lines = [...list].sort(order).flatMap((d) => [
    `${d.file}:${d.line}:${d.column}  ${d.severity}  ${d.code}`,
    `  ${d.message}`,
    ...(d.fix ? [`  fix: ${d.fix.description}`] : []),
  ]);
  return [...lines, "", `check: ${s.errors} error(s), ${s.warnings} warning(s) in ${s.files} file(s)`].join("\n");
}

export function formatJson(list: Diagnostic[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 1, summary: summarize(list), diagnostics: [...list].sort(order), ...extra }, null, 2);
}
