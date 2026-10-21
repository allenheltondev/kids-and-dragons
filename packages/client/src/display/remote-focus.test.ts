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

  it("stays inside a dialog that has focus, such as the sign-in over the Room panel", () => {
    lay(
      '<button id="behind">Lock the room</button><div role="dialog"><input id="email" type="email" /><button id="send">Send</button></div>',
      { behind: at(0, 100), email: at(0, 0), send: at(0, 200) },
    );
    document.getElementById("email")!.focus();
    step("down");
    expect(document.activeElement?.id).toBe("send");
    expect(step("down")).toBe(false);
    expect(document.activeElement?.id).toBe("send");
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

  const press = (key: string): KeyboardEvent => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(event);
    return event;
  };

  it("picks up near where focus was when OK took away the control it was on", () => {
    lay('<button id="top">top</button><button id="was">Host a game</button><button id="near">Open the lobby here</button>', {
      top: at(0, 0), was: at(0, 300), near: at(0, 320),
    });
    const stop = installRemoteFocus();
    document.getElementById("was")!.focus();
    document.getElementById("was")!.remove();
    expect(press("ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe("near");
    stop();
  });

  it("leaves Left and Right to a text field, for its caret", () => {
    lay('<input id="field" /><button id="b">b</button>', { field: at(0, 0), b: at(60, 0) });
    const stop = installRemoteFocus();
    document.getElementById("field")!.focus();
    expect(press("ArrowRight").defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe("field");
    stop();
  });

  it("reaches the sign-in's fields, and Up and Down leave a one-line one", () => {
    // Review of #392: the remote could open "Let visitors join" but not reach its email field.
    lay('<button id="open">Let visitors join</button><input id="email" type="email" /><button id="send">Send</button>', {
      open: at(0, 0), email: at(0, 60), send: at(0, 120),
    });
    const stop = installRemoteFocus();
    document.getElementById("open")!.focus();
    press("ArrowDown");
    expect(document.activeElement?.id).toBe("email");
    press("ArrowDown");
    expect(document.activeElement?.id).toBe("send");
    press("ArrowUp");
    expect(document.activeElement?.id).toBe("email");
    press("ArrowUp");
    expect(document.activeElement?.id).toBe("open");
    stop();
  });

  it("leaves any field on Escape and then an arrow, so a remote is never stuck in one", () => {
    lay('<select id="pick"><option>a</option><option>b</option></select><button id="b">b</button>', { pick: at(0, 0), b: at(60, 0) });
    const stop = installRemoteFocus();
    document.getElementById("pick")!.focus();
    // A select keeps its own Up and Down.
    expect(press("ArrowDown").defaultPrevented).toBe(false);
    expect(document.activeElement?.id).toBe("pick");
    press("Escape");
    press("ArrowRight");
    expect(document.activeElement?.id).toBe("b");
    stop();
  });

  it("forgets an Escape once another key comes", () => {
    lay('<input id="field" /><button id="b">b</button>', { field: at(0, 0), b: at(60, 0) });
    const stop = installRemoteFocus();
    document.getElementById("field")!.focus();
    press("Escape");
    press("a");
    press("ArrowRight");
    expect(document.activeElement?.id).toBe("field");
    stop();
  });
});

describe("what the arrows reach", () => {
  it("reaches a radio hidden inside the card that draws it, where the card stands, and OK checks it", () => {
    // Review of #392: the start screen's Party Mode and Phone Mode are radios hidden in their cards.
    lay(
      '<button id="host">Host a game</button>' +
        '<div role="radiogroup"><label id="party"><input id="r_party" type="radio" name="m" /></label>' +
        '<label id="phone"><input id="r_phone" type="radio" name="m" /></label></div>' +
        '<button id="go">Open the lobby here</button>',
      { host: at(0, 0), party: at(0, 60, 80), r_party: at(0, 60, 1), phone: at(100, 60, 80), r_phone: at(100, 60, 1), go: at(0, 160) },
    );
    // jsdom draws nothing: the labels say where they are like the rest.
    for (const id of ["party", "phone"]) {
      const el = document.getElementById(id)!;
      const box = { party: at(0, 60, 80), phone: at(100, 60, 80) }[id]!;
      el.getBoundingClientRect = () => ({ ...box, width: 80, height: 80, x: box.left, y: box.top, toJSON: () => box }) as DOMRect;
    }
    const stop = installRemoteFocus();
    const press = (key: string): void => {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    };
    document.getElementById("host")!.focus();
    press("ArrowDown");
    expect(document.activeElement?.id).toBe("r_party");
    // The arrows move past a radio rather than along its group.
    press("ArrowRight");
    expect(document.activeElement?.id).toBe("r_phone");
    expect((document.getElementById("r_phone") as HTMLInputElement).checked).toBe(false);
    press("Enter");
    expect((document.getElementById("r_phone") as HTMLInputElement).checked).toBe(true);
    press("ArrowLeft");
    press("Enter");
    expect((document.getElementById("r_party") as HTMLInputElement).checked).toBe(true);
    press("ArrowDown");
    expect(document.activeElement?.id).toBe("go");
    stop();
  });

  it("skips a hidden radio that nothing draws", () => {
    lay('<input id="radio" type="radio" /><button id="b">b</button>', { radio: at(0, 0, 1), b: at(60, 0) });
    step("right");
    expect(document.activeElement?.id).toBe("b");
  });
});
