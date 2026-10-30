/**
 * The grown-up's guide (#257), held to the screens it describes.
 *
 * - It parses, opens with a quick start that fits on a page, and is a few
 *   minutes' read.
 * - US spelling and no em dashes, like the game's own text.
 * - Every **bold** label is a string the client (or the server's messages,
 *   or content/help.json) really shows, and so is every "quoted" line, with
 *   the example names taken out. Rename a button and this names the line of
 *   the guide that went stale.
 * - Every picture is taken by an e2e spec (`guidePicture()`, run by
 *   `npm run guide:pictures`), is on disk, and has words for a screen reader;
 *   no picture on disk is left over.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGuide, words } from "../../packages/client/src/guide/markdown.ts";
import { checkText } from "../content/spelling-lint.mjs";
import { pictureSpecs } from "./pictures.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const GUIDE_DIR = path.join(ROOT, "packages", "client", "src", "guide");
const GUIDE = path.join(GUIDE_DIR, "guide.md");
const SETUP = path.join(GUIDE_DIR, "setup.md");
const PICTURES = path.join(ROOT, "packages", "client", "public", "guide-pictures");

const source = readFileSync(GUIDE, "utf8");
const guide = parseGuide(source);
const setupSource = readFileSync(SETUP, "utf8");
const setup = parseGuide(setupSource);
/** Both pages, for what holds of every word a grown-up reads. */
const pages = [guide, setup];

/** The example names the guide uses where a screen shows a kid's own. */
const EXAMPLE_NAMES = ["Rosie", "Sam", "Pip"];

function files(dir, keep) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full, keep);
    return keep(full) ? [full] : [];
  });
}

/** Everything a screen can say: the client's code, the server's messages and the help words. */
const SCREENS = [
  ...files(path.join(ROOT, "packages", "client", "src"), (f) => /\.tsx?$/.test(f) && !/\.test\./.test(f) && !f.includes(`${path.sep}guide${path.sep}`)),
  ...files(path.join(ROOT, "packages", "shared", "src"), (f) => f.endsWith(".ts") && !/\.test\./.test(f)),
  ...files(path.join(ROOT, "packages", "server", "src", "handlers"), (f) => f.endsWith(".ts") && !/\.test\./.test(f)),
  path.join(ROOT, "content", "help.json"),
]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")
  .replace(/&rsquo;|[‘’]/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/\s+/g, " ");

function runs(blocks) {
  return blocks.flatMap((block) => {
    if (block.kind === "paragraph" || block.kind === "note") return [block.text];
    if (block.kind === "list") return block.items;
    return [];
  });
}

const allRuns = pages.flatMap((page) => [page.intro, ...page.sections.map((s) => s.blocks)]).flatMap(runs);
const bold = [...new Set(allRuns.flat().filter((run) => run.bold).map((run) => run.text))];
const quoted = [
  ...new Set(allRuns.flatMap((text) => [...text.map((run) => run.text).join("").matchAll(/"([^"]+)"/g)].map((m) => m[1]))),
];
const pictures = pages.flatMap((page) => page.sections).flatMap((s) => s.blocks).filter((b) => b.kind === "picture");

describe("the grown-up's guide", () => {
  it("opens with a quick start that fits on one printed page", () => {
    expect(guide.sections[0]?.title).toBe("Quick start");
    const quick = { title: "", intro: guide.sections[0].blocks, sections: [] };
    expect(words(quick)).toBeLessThanOrEqual(320);
  });

  it("is a few minutes' read", () => {
    // About ten minutes at a grown-up's 240 words a minute, which the guide's
    // first lines promise. Room to fold a session's questions back in, not a target.
    expect(words(guide)).toBeLessThanOrEqual(2400);
    // The accounts and groups page is look-up, never the tonight page's ten minutes.
    expect(words(setup)).toBeLessThanOrEqual(1600);
  });

  it("keeps what tonight needs off the accounts and groups page", () => {
    expect(guide.sections.every((s) => s.part === null)).toBe(true);
    expect(setup.sections.map((s) => s.part).every((part) => part !== null)).toBe(true);
    expect(setup.sections.some((s) => /Quick start/.test(s.title))).toBe(false);
  });

  it("covers every flow a grown-up runs", () => {
    const titles = pages.flatMap((page) => page.sections).map((s) => s.title);
    for (const topic of [/Party Mode or Phone Mode/, /seating the kids/, /Running the room/, /leaves or arrives/, /Stopping and coming back/, /easier to play/, /signing in/, /tablet/, /Visitors/, /group/, /new device/, /Moving a hero/, /Deleting/]) {
      expect(titles.some((t) => topic.test(t)), String(topic)).toBe(true);
    }
  });

  it("uses US spelling and no em or en dashes", () => {
    const both = `${source}\n${setupSource}`;
    expect(both).not.toMatch(/[–—]/);
    expect(checkText(both).map((hit) => `${hit.word} -> ${hit.suggestion}`)).toEqual([]);
  });

  it("never counts the party", () => {
    expect(`${source}\n${setupSource}`).not.toMatch(/\ball (two|three|four) of you\b/i);
  });

  it.each(bold)("shows **%s**, which a screen really says", (label) => {
    expect(SCREENS.includes(label), `no screen says "${label}"`).toBe(true);
  });

  it.each(quoted)('quotes "%s" as a screen says it', (line) => {
    const pieces = line.split(new RegExp(`\\b(?:${EXAMPLE_NAMES.join("|")})\\b`)).map((p) => p.trim()).filter((p) => p.length > 1);
    for (const piece of pieces) expect(SCREENS.includes(piece), `no screen says "${piece}"`).toBe(true);
  });

  it("shows only pictures an e2e spec takes, each on disk and described", () => {
    const taken = new Set(pictureSpecs().flatMap((spec) => spec.names.map((name) => `${name}.jpg`)));
    expect(pictures.length).toBeGreaterThan(0);
    for (const picture of pictures) {
      expect(taken.has(picture.name), `${picture.name} is taken by a spec`).toBe(true);
      expect(statSync(path.join(PICTURES, picture.name)).size, picture.name).toBeGreaterThan(1000);
      expect(picture.alt.length, picture.name).toBeGreaterThan(10);
    }
  });

  it("leaves no picture on disk that it does not show", () => {
    const shown = new Set(pictures.map((p) => p.name));
    expect(readdirSync(PICTURES).filter((f) => !shown.has(f))).toEqual([]);
  });
});

describe("the guide's Markdown", () => {
  it("refuses what the screen cannot draw", () => {
    expect(() => parseGuide("# T\n\nSome _italic_ here")).toThrow(/does not draw/);
    expect(() => parseGuide("# T\n\nAn **unclosed bold")).toThrow(/unclosed/);
    expect(() => parseGuide("# T\n\n#### Too deep")).toThrow(/deeper/);
    expect(() => parseGuide("No title")).toThrow(/no title/);
  });

  it("reads sections, lists, wrapped items and pictures", () => {
    const g = parseGuide("# T\n\nHi **there**.\n\n## One\n\n- a\n  b\n- c\n\n1. x\n\n![A picture of it](../x/y.jpg)\n\n### Sub\n\nEnd\nline.");
    expect(g.intro).toEqual([{ kind: "paragraph", text: [{ text: "Hi ", bold: false }, { text: "there", bold: true }, { text: ".", bold: false }] }]);
    expect(g.sections[0].id).toBe("one");
    expect(g.sections[0].blocks.map((b) => b.kind)).toEqual(["list", "list", "picture", "subheading", "paragraph"]);
    expect(g.sections[0].blocks[0].items[0].map((r) => r.text).join("")).toBe("a b");
    expect(g.sections[0].blocks[2]).toEqual({ kind: "picture", alt: "A picture of it", name: "y.jpg" });
    expect(g.sections[0].blocks[4].text[0].text).toBe("End line.");
  });

  it("reads notes and the parts that sections sit in", () => {
    const g = parseGuide("# T\n\n> Hi\n> **there**\n>\n> Again\n\n<!-- part: First -->\n\n## One\n\n> Aside\n\nBody\n\n## Two\n\n<!-- part: Second -->\n\n## Three\n\n- a");
    expect(g.intro).toEqual([{ kind: "note", text: [{ text: "Hi ", bold: false }, { text: "there", bold: true }, { text: " Again", bold: false }] }]);
    expect(g.sections.map((s) => s.part)).toEqual(["First", "First", "Second"]);
    expect(g.sections[0].blocks.map((b) => b.kind)).toEqual(["note", "paragraph"]);
  });
});
