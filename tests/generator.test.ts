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

## Related guides

- [Related guide](guide.md)
`);
  await Bun.write(join(fixture, "guide.md"), `# Related guide

This page links [back to the example](README.md).
`);
  await Bun.write(join(fixture, "site.webmanifest"), JSON.stringify({
    name: "Example docs",
  }));

  await $`${process.execPath} run ${generator} ${fixture} --out ${regularOut} --manifest site.webmanifest`.quiet();
  await $`${process.execPath} run ${generator} ${fixture} --out ${minimalOut} --manifest site.webmanifest --hide-generator-attribution --hide-footer-actions --hide-related-pages`.quiet();
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
  expect(html).toContain("ol > li::marker { color: var(--muted); font-weight: 600; }");
  expect(html).not.toContain("\nli::marker { color: var(--line); }");
  expect(html).toContain('<div class="table-wrap" tabindex="0"><table>');
  expect(html).toContain("border-bottom: 1px solid color-mix");
  expect(html).not.toMatch(/\b(?:th|td)\b[^{}]*\{[^}]*border-right/);
});

test("writes llms.txt and llms-full.txt without a base URL", async () => {
  const llms = await Bun.file(join(regularOut, "llms.txt")).text();
  expect(llms).toStartWith("# Example docs\n\n> Use this guide to understand the example workflow.\n\n## Docs\n\n");
  expect(llms).toContain("- [Example docs](index.md): Use this guide to understand the example workflow.");
  expect(llms).toContain("- [Related guide](guide.md): This page links");
  const full = await Bun.file(join(regularOut, "llms-full.txt")).text();
  expect(full).toStartWith("# Example docs\nSource: index.html\n\n");
  expect(full).toContain("\n\n# Related guide\nSource: guide.html\n\n");
  expect(full.match(/^# Example docs$/gm)).toHaveLength(1);
  const html = await Bun.file(join(regularOut, "guide.html")).text();
  expect(html).toContain('<link rel="alternate" type="text/markdown" href="guide.md" />');
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
  expect(html).toContain('Selection changes emphasis only. Node positions remain identical in every state.');
  expect(html).toContain('for (const litPass of [false, true])');
  expect(html).toContain('if (e.dup) continue');
  expect(html).not.toContain('function focusLayout(f)');
  expect(html).not.toContain('let history = []');
  expect(html).toContain('function sectionOf(id)');
  expect(html).toContain('ctx.fillStyle = emphasized ? C.accent : C.muted');
  expect(html).toContain('ctx.strokeStyle = C.line');
  expect(html).toContain('screenRadius / cam.s');
  expect(html).toContain('Math.round(W * d)');
  expect(html).toContain('ctx.font = "500 14px " + fontFamily');
  expect(html).toContain('new ResizeObserver');
  expect(html).toContain('replace(/\\b\\w/g');
  expect(html).toContain('replace(/\\bIt\\b/g, "IT")');
  expect(html).toContain('.split(/\\s+/).filter(Boolean)');
  expect(html).not.toContain('.split(/s+/).filter(Boolean)');
  expect(html).not.toContain("const PALETTE");
  expect(html).not.toContain('class="graph-legend"');
  expect(html).toContain('const SKEY = "folder2website-graph-settings"');
});

test("supports an explicit generated related-pages opt-out", async () => {
  const html = await Bun.file(join(minimalOut, "index.html")).text();
  expect(html).toContain('id="related-guides"');
  expect(html).not.toContain('class="localmap"');
  expect(html).toContain('{"s":"index.html","t":"guide.html"}');
});

test("keeps related pages textual and graph navigation consistent", async () => {
  const html = await Bun.file(join(regularOut, "index.html")).text();
  expect(html).toContain('<div class="related-grid">');
  expect(html).toContain('<a href="guide.html">Related guide</a>');
  expect(html.match(/<h2>Related pages<\/h2>/g)).toHaveLength(1);
  expect(html).toContain("Related guides");
  expect(html).not.toContain("localmap-canvas");
  expect(html).toContain('<strong class="graph-title">Knowledge graph</strong>');
  expect(html).toContain('<button type="button" class="graph-close">Close</button>');
  expect(html).toContain('<label class="graph-toggle"><input type="checkbox" class="graph-backlinks" /> Backlinks</label>');
  expect(html).toContain('class="ds-toggle graph-open"');
  expect(html).toContain('class="localmap-explore graph-open graph-open-current"');
  expect(html).toContain("Explore in graph →");
  expect(html).not.toContain("← Whole graph");
  expect(html).not.toContain('class="graph-back"');
  expect(html).not.toContain('class="graph-overview"');
  expect(html).not.toContain('class="graph-gear"');
  expect(html).toContain(".related-grid { display: flex; flex-direction: column");
});

test("reserves laptop space for graph details", async () => {
  const html = await Bun.file(join(regularOut, "index.html")).text();
  expect(html).toContain('<div class="graph-stage">');
  expect(html).toContain(".graph-stage.has-detail { grid-template-columns: minmax(0, 1fr) 320px; }");
  expect(html).toContain('stage.classList.toggle("has-detail", !!f)');
  expect(html).toContain('<ul class="gd-links"></ul>');
  expect(html).toContain('<ul class="gd-backlink-list"></ul>');
  expect(html).toContain('<button type="button" class="gd-recenter" hidden>Recenter graph</button>');
  expect(html).toContain('function syncRecenter() { gdRecenter.hidden = !userCam; }');
  expect(html).toContain('renderRelations(gdLinks, gdOutGroup, "Links", f.out)');
  expect(html).toContain('renderRelations(gdBacklinks, gdInGroup, "Backlinks", f.inc)');
  expect(html).toContain('const overlay = W < 800 && !detail.hidden');
  expect(html).toContain('max-height: min(38vh, 360px)');
});

test("renders themed PlantUML SVGs locally, namespaces IDs, and reuses the cache", async () => {
  const docs = join(work, "plantuml"), out = join(work, "plantuml-out");
  const renderer = join(work, "renderer.ts"), calls = join(work, "renderer-calls");
  await Bun.write(renderer, `const source = await new Response(Bun.stdin.stream()).text();
const calls = Bun.file(${JSON.stringify(calls)});
await Bun.write(calls, (await calls.exists() ? await calls.text() : "") + source + "\\n---\\n");
console.log('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="200" viewBox="0 0 1200 200"><defs><linearGradient id="paint" /></defs><g id="node" fill="url(#paint)"><a href="#node"><text>Diagram</text></a></g></svg>');
`);
  const activity = "@startuml\n|Customer|\nstart\n:Request;\n|App|\nif (Ready?) then (yes)\n:Send;\nelse (no)\n:Wait;\nendif\nstop\n@enduml";
  await Bun.write(join(docs, "README.md"), `# Diagrams\n\nExample workflow.\n\n\`\`\`plantuml\n${activity}\n\`\`\`\n\n\`\`\`plantuml\n${activity}\n\`\`\`\n\n\`\`\`plantuml\n[*] --> Ready\nReady --> [*]\n\`\`\`\n`);
  await Bun.write(join(docs, "manifest.json"), JSON.stringify({ background_color: "#ffffff", theme_color: "#123456", readme_site: { fg: "#222222", font: "Example Font", dark: { bg: "#111111", fg: "#eeeeee", accent: "#abcdef" } } }));
  const env = { ...process.env, FOLDER2WEBSITE_PLANTUML: `"${process.execPath}" "${renderer}"` };
  await $`${process.execPath} run ${generator} ${docs} --out ${out}`.env(env).quiet();
  const html = await Bun.file(join(out, "index.html")).text();
  expect(html.match(/<pre class="mermaid plantuml ready"/g)).toHaveLength(3);
  expect(html.match(/<svg xmlns=/g)).toHaveLength(6);
  expect(html.match(/class="plantuml-light"/g)).toHaveLength(3);
  expect(html.match(/class="plantuml-dark"/g)).toHaveLength(3);
  const ids = [...html.matchAll(/id="(puml-[^"]+)"/g)].map((m) => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  expect(html).toContain('fill="url(#puml-1-0-paint)"');
  expect(html).toContain('href="#puml-1-0-node"');
  expect(html).toContain('pre.plantuml:not(.failed) { display: block; overflow-x: auto;');
  expect(html).toContain('matchMedia("(prefers-color-scheme: dark)").matches ? ".plantuml-dark svg"');
  expect(await Bun.file(join(out, "mermaid.min.js")).exists()).toBe(false);
  const inputs = await Bun.file(calls).text();
  expect(inputs.match(/^---$/gm)).toHaveLength(4);
  expect(inputs).toContain('skinparam defaultFontName "Example Font"');
  expect(inputs).toContain("skinparam backgroundColor #ffffff");
  expect(inputs).toContain("skinparam backgroundColor #111111");
  expect(inputs).toContain("skinparam stateBorderColor #abcdef");
  expect(inputs).toContain("skinparam activityBorderColor #123456");
  await $`${process.execPath} run ${generator} ${docs} --out ${out}`.env(env).quiet();
  expect(await Bun.file(calls).text()).toBe(inputs);
  await Bun.write(join(docs, "README.md"), (await Bun.file(join(docs, "README.md")).text()) + '\n```mermaid\ngraph TD\nA --> B\n```\n');
  await $`${process.execPath} run ${generator} ${docs} --out ${out}`.env(env).quiet();
  const mixed = await Bun.file(join(out, "index.html")).text();
  expect(mixed).toContain('document.querySelectorAll("pre.mermaid:not(.plantuml)")');
  expect(mixed).toContain('<pre class="mermaid">graph TD');
  expect(await Bun.file(join(out, "mermaid.min.js")).exists()).toBe(true);
  expect(await Bun.file(calls).text()).toBe(inputs);
}, 30000);

test("PlantUML failures preserve escaped source and warn once per fence", async () => {
  const docs = join(work, "plantuml-failure"), out = join(work, "plantuml-failure-out");
  const renderer = join(work, "failed-renderer.ts");
  await Bun.write(renderer, 'console.error("deliberate renderer failure"); process.exit(1);');
  await Bun.write(join(docs, "README.md"), '# Failure\n\nDiagram example.\n\n```plantuml\n:Keep <source> & text;\n```\n');
  const env = { ...process.env, FOLDER2WEBSITE_PLANTUML: `"${process.execPath}" "${renderer}"` };
  const result = await $`${process.execPath} run ${generator} ${docs} --out ${out}`.env(env).quiet();
  expect(result.stderr.toString().match(/PlantUML:/g)).toHaveLength(1);
  const html = await Bun.file(join(out, "index.html")).text();
  expect(html).toContain('class="mermaid plantuml ready failed" data-error="deliberate renderer failure"');
  expect(html).toContain(":Keep &lt;source> &amp; text;");
  expect(html).toContain('content: "This diagram did not render. " attr(data-error)');
});

test("PlantUML rejects non-SVG output and handles a missing renderer", async () => {
  const docs = join(work, "plantuml-invalid"), out = join(work, "plantuml-invalid-out");
  const renderer = join(work, "invalid-renderer.ts");
  await Bun.write(renderer, 'console.log("not an SVG");');
  await Bun.write(join(docs, "README.md"), '# Invalid\n\nDiagram example.\n\n```plantuml\nstart\nstop\n```\n');
  for (const command of [`"${process.execPath}" "${renderer}"`, "folder2website-missing-renderer"]) {
    const env = { ...process.env, FOLDER2WEBSITE_PLANTUML: command };
    const result = await $`${process.execPath} run ${generator} ${docs} --out ${out}`.env(env).quiet();
    expect(result.stderr.toString().match(/PlantUML:/g)).toHaveLength(1);
    const html = await Bun.file(join(out, "index.html")).text();
    expect(html).toContain('class="mermaid plantuml ready failed"');
    expect(html).toContain("start\nstop</pre>");
  }
  const env = { ...process.env, PATH: join(work, "empty-path") };
  delete env.FOLDER2WEBSITE_PLANTUML;
  const result = await $`${process.execPath} run ${generator} ${docs} --out ${out}`.env(env).quiet();
  expect(result.stderr.toString().match(/PlantUML:/g)).toHaveLength(1);
  expect(await Bun.file(join(out, "index.html")).text()).toContain('data-error="No local PlantUML renderer found"');
});
