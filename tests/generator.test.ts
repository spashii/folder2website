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

| Field | Meaning |
| --- | --- |
| Owner | Person responsible |
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
});

test("keeps tables simple and keyboard-scrollable", async () => {
  const html = await Bun.file(join(regularOut, "index.html")).text();
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
  expect(html).toContain('C.fg + "0d" : back ? C.fg + "18" : C.fg + "26"');
  expect(html).toContain('F + (hover === p.n ? "26" : "14")');
  expect(html).toContain('const SKEY = "folder2website-graph-settings"');
});
