import { afterAll, expect, test } from "bun:test";
import { $ } from "bun";
import { join } from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const work = mkdtempSync(join(tmpdir(), "folder2website-check-"));
const generator = join(import.meta.dir, "..", "index.ts");
const run = (...args: string[]) => $`${process.execPath} run ${generator} ${args}`.nothrow().quiet();
afterAll(() => rmSync(work, { recursive: true, force: true }));

test("--check reports planted defects with file, line and a fix, and exits 1", async () => {
  const docs = join(work, "defects");
  await Bun.write(join(docs, "README.md"), `# Home

Start here.

- [Guide](guide.md)
- [Typo](giude.md)
- [Missing section](guide.md#nowhere)
- [Deep section](guide.md#deep-detail)
- [Real section](guide.md#setup)
- [Outside](../elsewhere/page.md)

![Diagram](missing.png)

## Same page

[Jump](#same-page) and [jump nowhere](#gone).
`);
  await Bun.write(join(docs, "guide.md"), `# Guide

Steps.

## Setup

#### Deep detail

\`\`\`
# not a heading
\`\`\`

# Second title
`);
  await Bun.write(join(docs, "stray.md"), "# Stray\n");
  await Bun.write(join(docs, "_notes", "draft.md"), "# Private draft\n");

  const r = await run(docs, "--check", "--json");
  expect(r.exitCode).toBe(1);
  const out = JSON.parse(r.stdout.toString());
  const found = out.diagnostics.map((d) => `${d.file}:${d.line} ${d.code}`);
  expect(found).toEqual([
    "guide.md:7 f2w/heading-hierarchy",
    "guide.md:9 f2w/code-block-lang",
    "guide.md:13 f2w/single-h1",
    "README.md:6 f2w/broken-link",
    "README.md:7 f2w/broken-anchor",
    "README.md:8 f2w/broken-anchor",
    "README.md:10 f2w/outside-folder",
    "README.md:12 f2w/missing-asset",
    "README.md:16 f2w/broken-anchor",
    "stray.md:1 f2w/unlinked-file",
  ]);
  expect(out.diagnostics[3].fix.description).toBe('did you mean "guide.md"?');
  expect(out.diagnostics[3].column).toBe(10);
  expect(out.summary).toEqual({ errors: 5, warnings: 5, total: 10, files: 3 });
  expect(existsSync(join(docs, "site"))).toBe(false);

  const pretty = (await run(docs, "--check")).stdout.toString();
  expect(pretty).toContain("README.md:6:10  error  f2w/broken-link\n  \"giude.md\" does not exist\n  fix: did you mean \"guide.md\"?");
  expect(pretty).toContain("check: 5 error(s), 5 warning(s) in 3 file(s)");
});

test("a clean folder checks clean, and a normal build still succeeds with findings", async () => {
  const docs = join(work, "clean");
  await Bun.write(join(docs, "README.md"), "# Clean\n\nIntro.\n\n- [Next](next.md#usage)\n");
  await Bun.write(join(docs, "next.md"), "# Next\n\n## Usage\n\n```sh\necho ok\n```\n");
  const r = await run(docs, "--check");
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString()).toContain("check: clean");

  await Bun.write(join(docs, "README.md"), "# Clean\n\nIntro.\n\n- [Next](next.md#nope)\n");
  const b = await run(docs, "--out", join(work, "clean-out"));
  expect(b.exitCode).toBe(0);
  expect(b.stderr.toString()).toContain("f2w/broken-anchor");
  expect(existsSync(join(work, "clean-out", "index.html"))).toBe(true);
});

test("review marking: awaiting until marked, changed after an edit, with what changed", async () => {
  const docs = join(work, "review"), out = join(work, "review-out");
  await Bun.write(join(docs, "README.md"), "# Handbook\n\nHow we work.\n\n- [Access](access.md)\n- [Team](team.md)\n");
  await Bun.write(join(docs, "access.md"), "# Access\n\nAsk Sam for keys.\n\nKeys rotate monthly.\n");
  await Bun.write(join(docs, "team.md"), "# Team\n\nFive people.\n");

  // Off by default: marking records state but shows nothing without --review.
  const quiet = await run(docs, "--out", out, "--mark-reviewed", "access.md", "--reviewer", "Sameer");
  expect(quiet.stdout.toString()).not.toContain("review:");
  expect(await Bun.file(join(out, "index.html")).text()).not.toContain('class="review-badge"');
  expect(await Bun.file(join(out, "team.md")).text()).not.toContain("Review status");
  expect(await Bun.file(join(out, "llms.txt")).text()).not.toContain("Awaiting review");

  const marked = await run(docs, "--out", out, "--review");
  expect(marked.stdout.toString()).toContain("review: 2 awaiting, 1 reviewed (reviewed.json)");
  const store = await Bun.file(join(docs, "reviewed.json")).json();
  expect(Object.keys(store.pages)).toEqual(["access.md"]);
  expect(store.pages["access.md"].by).toBe("Sameer");
  expect(store.pages["access.md"].hash).toStartWith("sha256:");

  const home = await Bun.file(join(out, "index.html")).text();
  expect(home).toContain('<p class="rq-title">Awaiting review (2)</p>');
  expect(home).toContain('<a href="index.html">Handbook</a> <span class="rq-why">new</span>');
  expect(home).toContain('<a href="team.html">Team</a>');
  expect(home).not.toContain('<a href="access.html">Access</a> <span class="rq-why">');
  expect(home).toContain('Team<span class="review-dot" title="Awaiting review">');
  const access = await Bun.file(join(out, "access.html")).text();
  expect(access).not.toContain('class="review-badge"');
  expect(access).toContain("Reviewed less than a minute ago by Sameer");
  expect(await Bun.file(join(out, "team.html")).text()).toContain('<p class="review-badge"><span class="review-dot"></span>Awaiting review</p>');
  expect(await Bun.file(join(out, "team.md")).text()).toStartWith("> Documentation index: llms.txt\n> Fetch it to find every page of this site.\n> Review status: Awaiting review: no person has checked this page yet.\n\n# Team");
  expect(await Bun.file(join(out, "access.md")).text()).toContain("> Review status: Reviewed by Sameer on ");
  const llms = await Bun.file(join(out, "llms.txt")).text();
  expect(llms).toContain("- [Team](team.md): Awaiting review. Five people.");
  expect(llms).toContain("- [Access](access.md): Ask Sam for keys.");
  expect(await Bun.file(join(out, "llms-full.txt")).text()).not.toContain("Review status");

  // Whitespace is not an edit; a changed paragraph is.
  await Bun.write(join(docs, "access.md"), "# Access\n\nAsk Sam for keys.   \n\n\n\nKeys rotate monthly.\n");
  await run(docs, "--out", out, "--review");
  expect(await Bun.file(join(out, "access.html")).text()).not.toContain('class="review-badge"');
  await Bun.write(join(docs, "access.md"), "# Access\n\nAsk Sam for keys.\n\nKeys rotate weekly.\n");
  await run(docs, "--out", out, "--review");
  const changed = await Bun.file(join(out, "access.html")).text();
  expect(changed).toContain("Changed since Sameer reviewed it less than a minute ago");
  expect(changed).toContain('<div class="rd-mod"><span class="sr-only">Edited: </span>Keys rotate <del>monthly.</del><ins>weekly.</ins></div>');
  await Bun.write(join(docs, "access.md"), "# Access\n\nAsk Sam for keys.\n\nKeys rotate weekly.\n\nA wholly new paragraph.\n");
  await run(docs, "--out", out, "--review");
  expect(await Bun.file(join(out, "access.html")).text()).toContain('<div class="rd-add"><span class="sr-only">Added: </span>A wholly new paragraph.</div>');

  // --check reports review state but never writes it.
  const before = await Bun.file(join(docs, "reviewed.json")).text();
  expect(JSON.parse((await run(docs, "--check", "--json")).stdout.toString()).review).toBeUndefined();
  const c = await run(docs, "--check", "--json", "--review", "--mark-reviewed", "all");
  expect(JSON.parse(c.stdout.toString()).review).toEqual({ awaiting: [{ file: "README.md", state: "new" }, { file: "access.md", state: "changed" }, { file: "team.md", state: "new" }], reviewed: 0 });
  expect(await Bun.file(join(docs, "reviewed.json")).text()).toBe(before);

  await run(docs, "--out", out, "--review", "--mark-reviewed", "all");
  expect(await Bun.file(join(out, "index.html")).text()).toContain('<p class="review-queue review-clear">Every page is reviewed.</p>');
});

test("twins point at the index, and JSON-LD ships with a base URL", async () => {
  const docs = join(work, "agents"), out = join(work, "agents-out");
  await Bun.write(join(docs, "README.md"), "# Site\n\nAbout the site.\n\n- [Deep](a/b/deep.md)\n");
  await Bun.write(join(docs, "a", "b", "deep.md"), "# Deep\n\nDown here.\n");
  await run(docs, "--out", out);
  expect(await Bun.file(join(out, "a", "b", "deep.md")).text()).toStartWith("> Documentation index: ../../llms.txt\n");
  expect(await Bun.file(join(out, "index.html")).text()).not.toContain("application/ld+json");
  await run(docs, "--out", out, "--base-url", "https://docs.example.com");
  expect(await Bun.file(join(out, "a", "b", "deep.md")).text()).toStartWith("> Documentation index: https://docs.example.com/llms.txt\n");
  const deep = await Bun.file(join(out, "a", "b", "deep.html")).text();
  const ld = JSON.parse(deep.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  expect(ld).toMatchObject({ "@type": "WebPage", name: "Deep", url: "https://docs.example.com/a/b/deep.html", isPartOf: { "@type": "WebSite", name: "Site", url: "https://docs.example.com/" } });
  expect(deep).toContain('.replace(/^(?:> .*\\n)+\\n/, "")');
});
