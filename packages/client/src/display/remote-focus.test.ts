// @vitest-environment jsdom
/**
 * A remote's arrows on the shared screen (remote-focus.ts): to the nearest control that way,
 * from nowhere to the first, kept inside an open sheet, and left alone inside a text field.
 */

import { afterEach, describe, expect, it } from "vitest";
import { installRemoteFocus, nearest, step, type Box } from "./remote-focus";

const at = (left: number, top: number, size = 40): Box => ({ left, top, right: left + size, bottom: top + size });

describe("nearest", () => {
  const from = at(100, 100);
  it("finds the next control along the row", () => {
    expect(nearest(from, [at(200, 100), at(300, 100), at(0, 100)], "right")).toBe(0);
    expect(nearest(from, [at(200, 100), at(300, 100), at(0, 100)], "left")).toBe(2);
  });

  it("prefers straight ahead to nearer but off to the side", () => {
    expect(nearest(from, [at(150, 300), at(100, 330)], "down")).toBe(1);
  });

  it("finds nothing where nothing lies that way", () => {
    expect(nearest(from, [at(200, 100)], "up")).toBe(-1);
  });
});

/** Buttons laid out at fixed places: jsdom has no layout, so each says where it is. */
function lay(html: string, places: Record<string, Box>): void {
  document.body.innerHTML = html;
  for (const [id, box] of Object.entries(places)) {
    const el = document.getElementById(id)!;
    el.getBoundingClientRect = () => ({ ...box, width: box.right - box.left, height: box.bottom - box.top, x: box.left, y: box.top, toJSON: () => box }) as DOMRect;
    el.getClientRects = () => [el.getBoundingClientRect()] as unknown as DOMRectList;
  }
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("step", () => {
  it("starts on the first control, then walks the row", () => {
    lay('<button id="a">a</button><button id="b">b</button>', { a: at(0, 0), b: at(60, 0) });
    expect(step("right")).toBe(true);
    expect(document.activeElement?.id).toBe("a");
    expect(step("right")).toBe(true);
    expect(document.activeElement?.id).toBe("b");
    expect(step("right")).toBe(false);
    expect(document.activeElement?.id).toBe("b");
  });

  it("stays inside an open sheet", () => {
    lay(
      '<button id="out">out</button><div aria-modal="true"><button id="in1">1</button><button id="in2">2</button></div>',
      { out: at(0, 200), in1: at(0, 0), in2: at(0, 60) },
    );
    document.getElementById("in2")!.focus();
    expect(step("down")).toBe(false);
    expect(document.activeElement?.id).toBe("in2");
    step("up");
    expect(document.activeElement?.id).toBe("in1");
  });

  it("skips what is behind an inert page or disabled", () => {
    lay('<div inert><button id="behind">x</button></div><button id="off" disabled>y</button><button id="on">z</button>', {
      behind: at(0, 0), off: at(60, 0), on: at(120, 0),
    });
    step("right");
    expect(document.activeElement?.id).toBe("on");
  });
});

describe("installRemoteFocus", () => {
  it("moves focus on an arrow and swallows the key", () => {
    lay('<button id="a">a</button><button id="b">b</button>', { a: at(0, 0), b: at(60, 0) });
    const stop = installRemoteFocus();
    document.getElementById("a")!.focus();
    const event = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    document.getElementById("a")!.dispatchEvent(event);
    expect(document.activeElement?.id).toBe("b");
    expect(event.defaultPrevented).toBe(true);
    stop();
    document.getElementById("b")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.activeElement?.id).toBe("b");
  });

  it("leaves the arrows to a text field", () => {
    lay('<input id="field" /><button id="b">b</button>', { field: at(0, 0), b: at(60, 0) });
    const stop = installRemoteFocus();
    document.getElementById("field")!.focus();
    document.getElementById("field")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement?.id).toBe("field");
    stop();
  });
});
