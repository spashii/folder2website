import { afterAll, beforeAll, expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const work = mkdtempSync(join(tmpdir(), "folder2website-test-"));
const fixture = join(work, "docs");
const regularOut = join(work, "regular");
const minimalOut = join(work, "minimal");
const generator = join(import.meta.dir, "..", "index.ts");

beforeAll(async () => {
  await Bun.write(join(fixture, "README.md"), `# Example docs

[Open the console](https://app.example.com/projects)

Use this guide to understand the example workflow.

An [inline console link](https://app.example.com/settings) stays inline.

Continue with the [related guide](guide.md).

| Field | Meaning |
| --- | --- |
| Owner | Person responsible |
`);
  await Bun.write(join(fixture, "guide.md"), `# Related guide

This page links [back to the example](README.md).
`);
  await Bun.write(join(fixture, "site.webmanifest"), JSON.stringify({
    name: "Example docs",
  }));

  await $`${process.execPath} run ${generator} ${fixture} --out ${regularOut} --manifest site.webmanifest`.quiet();
  await $`${process.execPath} run ${generator} ${fixture} --out ${minimalOut} --manifest site.webmanifest --hide-generator-attribution --hide-footer-actions`.quiet();
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

test("renders standalone links as portable action buttons", async () => {
  const html = await Bun.file(join(regularOut, "index.html")).text();
  expect(html).toContain('<p class="actions"><a href="https://app.example.com/projects" class="btn action-link">Open the console</a></p>');
  expect(html.match(/class="btn action-link"/g)).toHaveLength(1);
  expect(html).toContain('<p class="tagline">Use this guide to understand the example workflow.</p>');
  expect(html).toContain('name="description" content="Use this guide to understand the example workflow."');
  expect(html).toContain('"d":"Use this guide to understand the example workflow.');
  expect(html).toContain("background: var(--bg); color: var(--accent)");
  expect(html).toContain("a.btn:hover { border-color: var(--accent); color: var(--fg); }");
});

test("keeps tables simple and keyboard-scrollable", async () => {
  const html = await Bun.file(join(regularOut, "index.html")).text();
  expect(html).toContain("--width: 40rem");
  expect(html).toContain('<div class="table-wrap" tabindex="0"><table>');
  expect(html).toContain("border-bottom: 1px solid color-mix");
  expect(html).not.toContain("border-right: 1px solid var(--line)");
});

test("supports explicit footer opt-outs", async () => {
  const regular = await Bun.file(join(regularOut, "index.html")).text();
  const minimal = await Bun.file(join(minimalOut, "index.html")).text();
  expect(regular).toContain('class="meta-actions"');
  expect(regular).toContain("Website made with");
  expect(minimal).not.toContain('class="meta-actions"');
  expect(minimal).not.toContain("Website made with");
});

test("uses quiet graph defaults", async () => {
  const html = await Bun.file(join(regularOut, "index.html")).text();
  expect(html).toContain('showBacklinks = _saved.backlinks === true');
  expect(html).toContain('if (!f) continue; // proximity and section clusters carry the overview');
  expect(html).toContain('if (focused && !nset.has(n.i)) continue');
  expect(html).toContain('function focusLayout(f)');
  expect(html).toContain('function sectionOf(id)');
  expect(html).toContain('ctx.fillStyle = big ? C.accent : C.muted');
  expect(html).toContain('ctx.strokeStyle = C.line');
  expect(html).toContain('screenRadius / cam.s');
  expect(html).toContain('(rad(n) * 1.4 + 5) / cam.s');
  expect(html).not.toContain('rad(n) * cam.s + 5');
  expect(html).not.toContain("const PALETTE");
  expect(html).not.toContain('class="graph-legend"');
  expect(html).toContain('const SKEY = "folder2website-graph-settings"');
});

test("keeps related pages textual and graph navigation consistent", async () => {
  const html = await Bun.file(join(regularOut, "index.html")).text();
  expect(html).toContain('<div class="related-grid">');
  expect(html).toContain('<a href="guide.html">Related guide</a>');
  expect(html).not.toContain("localmap-canvas");
  expect(html).toContain('<button type="button" class="graph-back">← Back</button>');
  expect(html).toContain('class="graph-overview" aria-label="Show whole graph"');
  expect(html).toContain('class="graph-gear" aria-haspopup="true" aria-expanded="false" aria-label="Settings" title="Settings"><svg');
  expect(html).toContain('class="ds-toggle graph-open graph-open-overview"');
  expect(html).toContain('class="localmap-explore graph-open graph-open-current"');
  expect(html).toContain("Explore in graph →");
  expect(html).not.toContain("← Whole graph");
  expect(html).not.toContain('class="graph-close"');
  expect(html).toContain(".related-grid { display: flex; flex-direction: column");
});

test("reserves laptop space for graph details", async () => {
  const html = await Bun.file(join(regularOut, "index.html")).text();
  expect(html).toContain('<div class="graph-stage">');
  expect(html).toContain(".graph-stage.has-detail { grid-template-columns: minmax(0, 1fr) 320px; }");
  expect(html).toContain('stage.classList.toggle("has-detail", !!f)');
  expect(html).toContain('<button type="button" class="gd-recenter" hidden>Recenter</button>');
  expect(html).toContain('function syncRecenter() { gdRecenter.hidden = !selected || !userCam; }');
});
