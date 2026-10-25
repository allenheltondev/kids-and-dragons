/**
 * What the shared screen's browser is allowed to be (#264, docs/hardware.md).
 *
 * The display is most often a smart TV's own browser, which runs years behind the panel it
 * is in: a 2024 Samsung is Tizen 8, Chromium 108. CSS does not degrade politely there. A
 * declaration a browser cannot parse is dropped whole, so one `color-mix()` behind the
 * narration is the difference between words on a scrim and words on painted art, and
 * nothing in the build warns: `build.target` in vite.config.ts lowers JavaScript syntax
 * and leaves CSS functions exactly as written.
 *
 * So the rule is: a value using anything newer than BASELINE needs the declaration before
 * it, same property, same block, to say the same thing in something older. A browser that
 * understands both takes the last one; a TV keeps the first.
 *
 * Adding a feature here is how the baseline moves. Raise BASELINE only once docs/hardware.md
 * has a real device row that proves it.
 */

import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The oldest browser the display is written for: Tizen 8's Chromium (2024 Samsung TVs). */
const BASELINE = 108;

/** Each needs a fallback declaration before it, with the Chromium version that added it. */
const GUARDED: { feature: RegExp; since: number; name: string }[] = [
  { feature: /\bcolor-mix\(/, since: 111, name: "color-mix()" },
  { feature: /\boklch\(|\boklab\(|\blch\(|\blab\(/, since: 111, name: "CIE colour functions" },
  { feature: /\blight-dark\(/, since: 123, name: "light-dark()" },
  { feature: /\d(?:dvh|dvw|dvi|dvb)\b/, since: 108, name: "dynamic viewport units" },
  { feature: /\bround\(|\bmod\(|\brem\(/, since: 125, name: "stepped-value functions" },
  { feature: /\banchor\(|\banchor-size\(/, since: 125, name: "anchor positioning" },
];

/**
 * Features that do nothing at all on an older browser rather than breaking what they are
 * on: the text is still there, just not balanced. These need no fallback.
 */
const PROGRESSIVE = [/^text-wrap/, /^scrollbar-/, /^accent-color$/, /^transition-behavior$/];

const root = fileURLToPath(new URL("..", import.meta.url));
const files = globSync("**/*.css", { cwd: root }).sort();

interface Declaration {
  property: string;
  value: string;
  /** The property of the declaration immediately before this one in the same block. */
  previous: string | null;
  line: number;
}

/**
 * Every declaration in a stylesheet, in order, each knowing what came before it in its own
 * block. A hand-rolled walk rather than a parser: these stylesheets are plain CSS (no
 * nesting — see the test below), so brace depth is enough to know where a block starts.
 */
export function declarations(css: string): Declaration[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const found: Declaration[] = [];
  let buffer = "";
  let line = 1;
  let startLine = 1;
  let previous: string | null = null;
  const flush = (): void => {
    const chunk = buffer.trim();
    buffer = "";
    if (chunk === "") return;
    const colon = chunk.indexOf(":");
    if (colon < 0) return;
    const property = chunk.slice(0, colon).trim();
    // A custom property's value can hold anything; it is not a declaration a browser drops.
    if (property.startsWith("--")) {
      previous = property;
      return;
    }
    found.push({ property, value: chunk.slice(colon + 1).trim(), previous, line: startLine });
    previous = property;
  };
  for (const char of text) {
    if (char === "\n") line += 1;
    if (buffer.trim() === "") startLine = line;
    if (char === "{" || char === "}") {
      // A block boundary: nothing before it is "the declaration above" any more.
      buffer = "";
      previous = null;
      continue;
    }
    if (char === ";") {
      flush();
      continue;
    }
    buffer += char;
  }
  return found;
}

describe("the stylesheets a smart TV has to read", () => {
  it("has stylesheets to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("puts a fallback before every value newer than the baseline", () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const declaration of declarations(readFileSync(`${root}${file}`, "utf8"))) {
        if (PROGRESSIVE.some((safe) => safe.test(declaration.property))) continue;
        for (const { feature, since, name } of GUARDED) {
          if (since <= BASELINE || !feature.test(declaration.value)) continue;
          if (declaration.previous === declaration.property) continue;
          missing.push(
            `${file}:${String(declaration.line)} — \`${declaration.property}\` uses ${name} (Chromium ${String(since)}), ` +
            `with no \`${declaration.property}\` before it for Chromium ${String(BASELINE)}`,
          );
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("defines every channel triplet it reads", () => {
    // `rgb(var(--x-rgb) / 70%)` with no `--x-rgb` anywhere is invalid at computed-value
    // time, which is a silent `unset`, not a parse error a build could catch.
    const all = files.map((file) => readFileSync(`${root}${file}`, "utf8")).join("\n");
    const read = new Set([...all.matchAll(/var\((--[a-z0-9-]+-rgb)\)/g)].map((match) => match[1] ?? ""));
    const defined = new Set([...all.matchAll(/(--[a-z0-9-]+-rgb)\s*:/g)].map((match) => match[1] ?? ""));
    expect([...read].filter((name) => !defined.has(name))).toEqual([]);
  });

  it("writes plain CSS, since the walk above reads brace depth", () => {
    for (const file of files) {
      const css = readFileSync(`${root}${file}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, `${file} uses CSS nesting`).not.toMatch(/^\s*&/m);
    }
  });
});
