/**
 * The chapter viewer's page.
 *
 * `chapter-map.test.ts` covers the layout model; this covers what is drawn from
 * it, and it exists because three separate bugs in this file's first afternoon
 * were all invisible in code review and all obvious in a browser:
 *
 *   1. Sibling edges out of one scene drawn as one curve with three labels
 *      stacked at the same point.
 *   2. Long edges routed *through* the boxes they were skipping, because the
 *      detour was measured from the source node rather than from the widest
 *      row.
 *   3. Routed labels centred back over those same boxes, because `.edge-label`
 *      sets `text-anchor: middle` in CSS and a CSS declaration beats an SVG
 *      presentation attribute. The detour was correct and the label undid it.
 *
 * All three are structural, so all three are assertable without a renderer.
 * The one thing a headless check cannot do is measure glyphs, so the collision
 * arithmetic that actually confirmed the picture was run in a real browser once
 * and is not repeated here — what is repeated is the *rule* each fix installed.
 */

import { describe, expect, it } from "vitest";
import { chapterMap, validateChapter } from "@kad/shared";
import type { Chapter, Scene } from "@kad/shared";
import { makeChapter } from "../../packages/shared/src/test-fixtures.ts";
import { page } from "./graph-page.ts";

const CHAPTER = makeChapter();

function render(chapter: Chapter): string {
  return page(chapter, chapterMap(chapter), validateChapter(chapter));
}

/** Just the drawing, so a CSS rule cannot be mistaken for a drawn element. */
function svgBody(html: string): string {
  return html.split("</defs>")[1]?.split("</svg>")[0] ?? "";
}

const HTML = render(CHAPTER);
const BODY = svgBody(HTML);

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("what gets drawn", () => {
  it("draws one box per scene and one curve per edge", () => {
    const map = chapterMap(CHAPTER);
    expect(count(BODY, '<g class="node')).toBe(map.nodes.length);
    expect(count(BODY, '<path class="edge')).toBe(map.edges.length);
  });

  it("gives every edge its own label", () => {
    // The first draft drew one label per *pair* of scenes, so three
    // species-gated choices to the same place read as one way through.
    expect(count(BODY, 'class="edge-label')).toBe(chapterMap(CHAPTER).edges.length);
  });

  it("dashes an edge the party has to match to see", () => {
    // Requirements hide a choice rather than greying it out (architecture §5),
    // so a gated edge is one not everybody gets — and a scene whose every edge
    // is gated is `chapter-graph.ts`'s DEAD_END.
    const gated = chapterMap(CHAPTER).edges.filter((edge) => edge.gate !== null);
    expect(gated.length).toBeGreaterThan(0);
    expect(count(BODY, "edge--gated")).toBe(gated.length);
  });

  it("names the entry scene as the start", () => {
    expect(BODY).toContain("story · start");
    expect(count(BODY, "node--entry")).toBe(1);
  });
});

describe("routing an edge that skips a row", () => {
  /*
   * The reference chapter's opening scene has three species-gated choices that
   * all land four rows down, plus two ordinary ones. Every property below is
   * about that scene, because it is the one that broke every naive version.
   */
  const long = chapterMap(CHAPTER).edges.filter((edge) => {
    const rows = new Map(chapterMap(CHAPTER).nodes.map((node) => [node.id, node.row]));
    const from = rows.get(edge.from);
    const to = rows.get(edge.to);
    return from !== undefined && to !== undefined && Math.abs(to - from) > 1;
  });

  it("has some to route, or this whole block is testing nothing", () => {
    expect(long.length).toBeGreaterThan(0);
  });

  it("anchors every routed label with a class, never an attribute", () => {
    /*
     * Bug 3, stated as a rule. `.edge-label { text-anchor: middle }` lives in
     * the stylesheet, and in SVG a CSS declaration beats a presentation
     * attribute — so `text-anchor="end"` on the element is silently ignored and
     * the label lands back on the boxes the detour went around.
     */
    expect(BODY).not.toContain("text-anchor=");
    expect(count(BODY, "edge-label--start") + count(BODY, "edge-label--end")).toBe(long.length);
  });

  it("gives the page a margin to route through", () => {
    // A chapter with a skip needs gutters; one without should not pay for them.
    const linear: Chapter = {
      ...CHAPTER,
      entry: "a",
      scenes: {
        a: { type: "story", narration: "…", choices: [{ id: "x", label: "on", icon: "arrow", goto: "b" }] },
        b: { type: "story", narration: "…", choices: [] },
      },
    };
    const wide = Number(/<svg width="(\d+)"/.exec(HTML)?.[1] ?? 0);
    const narrow = Number(/<svg width="(\d+)"/.exec(render(linear))?.[1] ?? 0);
    expect(wide).toBeGreaterThan(narrow + 200);
  });

  it("sends siblings to opposite sides of the trunk", () => {
    // Bug 1. Three curves and three labels at the same coordinates is one
    // curve and an unreadable smear.
    const starts = count(BODY, "edge-label--start");
    const ends = count(BODY, "edge-label--end");
    expect(starts).toBeGreaterThan(0);
    expect(ends).toBeGreaterThan(0);
  });
});

describe("a chapter that is broken", () => {
  const broken: Chapter = {
    ...CHAPTER,
    entry: "a",
    scenes: {
      a: {
        type: "story",
        narration: "…",
        choices: [{ id: "x", label: "into the void", icon: "arrow", goto: "ghost" }],
      },
      orphan: { type: "story", narration: "…", choices: [] },
    },
  };
  const html = render(broken);
  const body = svgBody(html);

  it("draws the arrow that goes nowhere instead of dropping it", () => {
    /*
     * `content:validate` reports it as UNKNOWN_GOTO. A picture that silently
     * omitted the broken choice would be hiding the one thing the author needs
     * to see, and would also show the scene as an ending, which it is not.
     */
    expect(body).toContain("edge--broken");
    expect(body).toContain("ghost — missing");
    // And drawn as a problem rather than as an ordinary label.
    expect(body).toContain("edge-label--broken");
  });

  it("marks a scene nothing reaches, and bands it off", () => {
    expect(body).toContain("node--orphan");
    expect(body).toContain("nothing reaches these");
  });

  it("flags the scenes the validator has findings against", () => {
    const flagged = new Set(
      validateChapter(broken)
        .map((issue) => issue.sceneId)
        .filter((id): id is string => id !== undefined),
    );
    expect(flagged.size).toBeGreaterThan(0);
    expect(count(body, "node-flag")).toBe(flagged.size);
  });

  it("counts the findings in the header rather than making the author hunt", () => {
    expect(html).toMatch(/\d+ (errors|warnings)/);
  });
});

describe("the inspector", () => {
  it("carries every scene's authored JSON, which is the branch inspection", () => {
    for (const id of Object.keys(CHAPTER.scenes)) {
      expect(HTML).toContain(`"${id}"`);
    }
    expect(HTML).toContain("A wall of thorns twice your height.");
  });

  it("cannot be closed early by authored narration", () => {
    /*
     * The scene blob is inlined in a `<script>`, and a chapter is authored
     * text — an author writing about a `</script>` tag in a narration line
     * would end the tag and dump the rest of the page as body text. Escaping
     * the `<` is what stops that.
     */
    const nasty: Chapter = {
      ...CHAPTER,
      entry: "a",
      scenes: {
        a: { type: "story", narration: "watch out for </script> tags", choices: [] } as Scene,
      },
    };
    const html = render(nasty);
    const scriptBody = html.split("const SCENES = ")[1]?.split("\n")[0] ?? "";
    expect(scriptBody).not.toContain("</script>");
    expect(scriptBody).toContain("\\u003c/script>");
  });

  it("escapes authored text in the drawing too", () => {
    const nasty: Chapter = {
      ...CHAPTER,
      entry: "a",
      scenes: {
        a: {
          type: "story",
          narration: "…",
          choices: [{ id: "x", label: "<b>bold</b> & brash", icon: "arrow", goto: "a" }],
        },
      },
    };
    const body = svgBody(render(nasty));
    expect(body).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; brash");
    expect(body).not.toContain("<b>bold</b>");
  });
});

describe("being a file you can just open", () => {
  it("fetches nothing and loads nothing", () => {
    // Same rule the rest of the tooling follows: no CDN, no build step, no dev
    // server. Regenerate and refresh.
    expect(HTML).not.toMatch(/https?:\/\//);
    expect(HTML).not.toContain("fetch(");
    expect(HTML).not.toContain("<script src");
    expect(HTML).not.toContain("<link");
  });
});
