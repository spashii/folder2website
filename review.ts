// Human review state, kept in reviewed.json beside the home page. Marking a page stores a
// fingerprint of its text and the text itself; when the page changes, the fingerprint stops
// matching and the page reads "awaiting review" again, with what changed since. Nothing here
// depends on git, so a plain folder of drafts works the same as a repo.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const REVIEW_FILE = "reviewed.json";
export type ReviewEntry = { hash: string; at: string; by: string; text: string };
export type Change = { op: "-" | "+" | "~"; text: string; words?: Word[] };
export type ReviewState = { state: "reviewed" | "changed" | "new"; at?: string; by?: string; changes?: Change[] };
type Store = { version: 1; pages: Record<string, ReviewEntry> };

// Trailing spaces, line endings and runs of blank lines are not edits a reviewer needs to see.
const normalize = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
export const fingerprint = (s: string) => "sha256:" + createHash("sha256").update(normalize(s)).digest("hex");

export async function loadReviews(root: string): Promise<Store | null> {
  const p = join(root, REVIEW_FILE);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(await Bun.file(p).text());
    return { version: 1, pages: data && typeof data.pages === "object" ? data.pages : {} };
  } catch (e) {
    throw new Error(`${REVIEW_FILE} is not valid JSON: ${e.message}`);
  }
}

export async function saveReviews(root: string, store: Store) {
  const pages = Object.fromEntries(Object.entries(store.pages).sort(([a], [b]) => a.localeCompare(b)));
  await Bun.write(join(root, REVIEW_FILE), JSON.stringify({ version: 1, pages }, null, 2) + "\n");
}

export function mark(store: Store, rel: string, raw: string, by: string, at = new Date().toISOString()) {
  store.pages[rel] = { hash: fingerprint(raw), at, by, text: normalize(raw) };
}

// Line-level difference, and inside a line that was edited rather than replaced, word-level:
// a reviewer should see the one sentence an agent added, not a whole table struck out.
export type Word = { op: "=" | "-" | "+"; text: string };
function lcsOps<T>(a: T[], b: T[]) {
  const n = a.length, m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: { op: "=" | "-" | "+"; i: number; j: number }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ op: "=", i: i++, j: j++ });
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) ops.push({ op: "-", i: i++, j });
    else ops.push({ op: "+", i, j: j++ });
  }
  for (; i < n; i++) ops.push({ op: "-", i, j });
  for (; j < m; j++) ops.push({ op: "+", i, j });
  return { ops, same: lcs[0][0] };
}
function wordDiff(before: string, after: string) {
  const a = before.split(/(\s+)/), b = after.split(/(\s+)/);
  const { ops, same } = lcsOps(a, b);
  const words: Word[] = [];
  for (const o of ops) {
    const text = o.op === "+" ? b[o.j] : a[o.i];
    const last = words[words.length - 1];
    if (last && last.op === o.op) last.text += text; else words.push({ op: o.op, text });
  }
  return { words, similar: same / Math.max(a.length, b.length) >= 0.5 };
}
function lineDiff(before: string, after: string) {
  const a = before.split("\n").filter((l) => l.trim()), b = after.split("\n").filter((l) => l.trim());
  const { ops } = lcsOps(a, b);
  const changes: Change[] = [];
  let removed: string[] = [], added: string[] = [];
  const flush = () => {
    const k = Math.min(removed.length, added.length);
    for (let x = 0; x < Math.max(removed.length, added.length); x++) {
      const w = x < k ? wordDiff(removed[x], added[x]) : null;
      if (w?.similar) changes.push({ op: "~", text: added[x], words: w.words });
      else {
        if (x < removed.length) changes.push({ op: "-", text: removed[x] });
        if (x < added.length) changes.push({ op: "+", text: added[x] });
      }
    }
    removed = []; added = [];
  };
  for (const o of ops) {
    if (o.op === "=") flush();
    else if (o.op === "-") removed.push(a[o.i]);
    else added.push(b[o.j]);
  }
  flush();
  return changes;
}

export function reviewState(store: Store, rel: string, raw: string): ReviewState {
  const e = store.pages[rel];
  if (!e) return { state: "new" };
  if (e.hash === fingerprint(raw)) return { state: "reviewed", at: e.at, by: e.by };
  return { state: "changed", at: e.at, by: e.by, changes: e.text ? lineDiff(e.text, normalize(raw)) : undefined };
}

export const needsReview = (r?: ReviewState) => !!r && r.state !== "reviewed";
const day = (iso?: string) => (iso || "").slice(0, 10);

// The line an agent reads at the top of a page's markdown, and beside it in llms.txt.
export function reviewNote(r: ReviewState) {
  if (r.state === "new") return "Awaiting review: no person has checked this page yet.";
  if (r.state === "changed") return `Awaiting review: changed since ${r.by || "a person"} reviewed it on ${day(r.at)}.`;
  return `Reviewed by ${r.by || "a person"} on ${day(r.at)}.`;
}
