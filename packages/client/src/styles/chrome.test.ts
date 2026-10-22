/**
 * The painted chrome (docs/briefs/tablet-chrome-art.md) and the stylesheet that lays it on.
 *
 * Every delivered piece is drawn somewhere, and everything the stylesheet draws was delivered: a
 * renamed file or a typo in a `url()` fails here, not as a blank frame on somebody's tablet. And
 * every rule that paints sits behind the high contrast guard, because high contrast keeps the flat
 * borders (the brief, §2.4).
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = fileURLToPath(new URL(".", import.meta.url));
const css = readFileSync(`${here}chrome.css`, "utf8");
const delivered = readdirSync(`${here}../assets/chrome`)
  .filter((file) => file.endsWith(".webp"))
  .map((file) => file.replace(/\.webp$/, ""))
  .sort();
const drawn = [...new Set([...css.matchAll(/url\("\.\.\/assets\/chrome\/([a-z-]+)\.webp"\)/g)].map((m) => m[1] ?? ""))].sort();

describe("the painted chrome", () => {
  it("draws every piece that was delivered, and only those", () => {
    expect(delivered.length).toBeGreaterThan(0);
    expect(drawn).toEqual(delivered);
  });

  it("paints only behind the high contrast guard", () => {
    // Each rule that hands a picture to the page names it directly or through `--chrome`; the
    // `--chrome` rules only set variables, which nothing reads unless a guarded rule does.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((rule) => rule.trim()).filter(Boolean);
    const painting = rules.filter((rule) => /(?:background|border-image)[^;]*url\(/.test(rule) || /border-image-source:\s*var\(/.test(rule));
    for (const rule of painting) {
      // The selector is what comes before the rule's own brace, past any `@media (…) {` opening it.
      const head = rule.slice(0, rule.lastIndexOf("{"));
      const selector = head.startsWith("@") ? head.slice(head.indexOf("{") + 1).trim() : head.trim();
      // The pane frame is drawn only from a guarded rule that shows it (`display: block`).
      if (selector.includes(".kad-pane-frame")) continue;
      expect(selector, selector).toContain('html:not([data-contrast="high"])');
    }
  });
});
