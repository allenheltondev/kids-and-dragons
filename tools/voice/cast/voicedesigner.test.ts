// @vitest-environment jsdom
/**
 * The "Design a new voice" panel (mode.ts), run in a DOM as the cast pages run it: the price on show is for the words in
 * the box now, an edit takes the candidates away, and a saved voice carries the description it was made from.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MODE_SCRIPT } from "./mode.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- the script is plain JavaScript with no types of its own. */
const mode = new Function(`${MODE_SCRIPT}\nreturn KadMode;`)() as any;
const dom = globalThis as any;
const event = (name: string): unknown => new dom.Event(name, { bubbles: true });
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

type Call = { route: string; body: any };
function panel(prices: (text: string) => number) {
  const calls: Call[] = [];
  const call = async (route: string, body: any) => {
    calls.push({ route, body });
    if (route === "/api/cast/design/brief") return { description: "A man's voice for a storybook.", text: "x".repeat(100), dollars: prices("x".repeat(100)), previews: 3, basis: "estimated" };
    if (route === "/api/cast/design/quote") return { dollars: prices(body.text), basis: "estimated" };
    if (route === "/api/cast/design/preview") return { previews: [{ generatedVoiceId: "GEN1", audio: "data:audio/mpeg;base64,AAAA" }], spent: 0.01, cap: 5 };
    if (route === "/api/cast/design/save") return { voice: { id: "NEW1", name: body.name, about: "designed" }, entry: {} };
    throw new Error(route);
  };
  const saved: unknown[] = [];
  const el = mode.voiceDesigner({ id: "wick", name: "Wick", call, onSaved: async (...args: unknown[]) => { saved.push(args); } });
  dom.document.body.append(el);
  return { el, calls, saved, area: el.querySelectorAll("textarea"), go: el.querySelector("button"), cost: el.querySelector(".tools .hint") };
}
const open = async (el: any) => { el.open = true; el.dispatchEvent(event("toggle")); await tick(); };

afterEach(() => {
  dom.document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("the design panel", () => {
  it("fills in from the sheet when opened, with the price on show", async () => {
    const { el, area, cost } = panel((text) => text.length / 1000);
    await open(el);
    expect(area[0].value).toBe("A man's voice for a storybook.");
    expect(area[1].value).toHaveLength(100);
    expect(cost.textContent).toBe("Hearing the candidates is about $0.10 of the session cap");
  });

  it("asks for the price again when the words are edited, and sends the price it showed with the request", async () => {
    const { el, area, cost, calls, go } = panel((text) => text.length / 1000);
    await open(el);
    area[1].value = "y".repeat(400);
    area[1].dispatchEvent(event("input"));
    await tick(300);
    expect(calls.filter((c) => c.route === "/api/cast/design/quote").pop()!.body.text).toHaveLength(400);
    expect(cost.textContent).toBe("Hearing the candidates is about $0.40 of the session cap");
    go.click();
    await tick(50);
    const preview = calls.find((c) => c.route === "/api/cast/design/preview")!;
    expect(preview.body.quote).toBeCloseTo(0.4, 9);
    expect(preview.body.text).toHaveLength(400);
  });

  it("keeps Hear off while the price for the current words is still being worked out, and never spends on a price fetched by the press", async () => {
    // The quote for the edited words is slow: the page must not spend on it, or on anything, until it is on show.
    const calls: { route: string; body: any }[] = [];
    let release: () => void = () => {};
    const call = async (route: string, body: any) => {
      calls.push({ route, body });
      if (route === "/api/cast/design/brief") return { description: "A man's voice for a storybook.", text: "x".repeat(100), dollars: 0.01, previews: 3, basis: "estimated" };
      if (route === "/api/cast/design/quote") { await new Promise<void>((resolve) => { release = resolve; }); return { dollars: 0.1, basis: "estimated" }; }
      return { previews: [{ generatedVoiceId: "GEN1", audio: "data:audio/mpeg;base64,AAAA" }], spent: 0.1, cap: 5 };
    };
    const el = mode.voiceDesigner({ id: "wick", name: "Wick", call, onSaved: async () => {} });
    dom.document.body.append(el);
    await open(el);
    const [, text] = el.querySelectorAll("textarea");
    const go = el.querySelector("button");
    expect(go.disabled).toBe(false);
    text.value = "y".repeat(1000);
    text.dispatchEvent(event("input"));
    expect(go.disabled).toBe(true);
    // Pressed at once, before the quote has even been asked for, and again while it is being fetched.
    go.click();
    await tick(300);
    go.click();
    expect(calls.filter((c) => c.route === "/api/cast/design/preview")).toHaveLength(0);
    expect(go.disabled).toBe(true);
    expect(el.querySelector(".tools .hint").textContent).toBe("Checking the price…");
    release();
    await tick(20);
    // Now the price is on show, and a fresh press spends exactly that.
    expect(el.querySelector(".tools .hint").textContent).toBe("Hearing the candidates is about $0.10 of the session cap");
    expect(go.disabled).toBe(false);
    expect(calls.filter((c) => c.route === "/api/cast/design/preview")).toHaveLength(0);
    go.click();
    await tick(20);
    const spent = calls.filter((c) => c.route === "/api/cast/design/preview");
    expect(spent).toHaveLength(1);
    expect(spent[0]!.body.quote).toBeCloseTo(0.1, 9);
  });

  it("shows a price that moved and spends nothing on it until it is pressed again", async () => {
    const calls: { route: string; body: any }[] = [];
    const call = async (route: string, body: any) => {
      calls.push({ route, body });
      if (route === "/api/cast/design/brief") return { description: "A man's voice for a storybook.", text: "x".repeat(100), dollars: 0.01, previews: 3, basis: "estimated" };
      throw Object.assign(new Error("The price changed to about $0.05 for these words: check it and go again."), { dollars: 0.05 });
    };
    const el = mode.voiceDesigner({ id: "wick", name: "Wick", call, onSaved: async () => {} });
    dom.document.body.append(el);
    await open(el);
    const go = el.querySelector("button");
    go.click();
    await tick(20);
    expect(el.querySelector(".tools .hint").textContent).toBe("Hearing the candidates is about $0.05 of the session cap");
    expect(calls.filter((c) => c.route === "/api/cast/design/preview")).toHaveLength(1);
    expect(go.disabled).toBe(false);
  });

  it("takes the candidates away when either box is edited, so a voice is never saved under another description", async () => {
    const { el, area, calls, go } = panel(() => 0.01);
    await open(el);
    go.click();
    await tick(50);
    expect(el.querySelectorAll(".previews > div")).toHaveLength(1);
    area[0].value = "A woman's voice instead.";
    area[0].dispatchEvent(event("input"));
    expect(el.querySelectorAll(".previews > div")).toHaveLength(0);
    expect(calls.some((c) => c.route === "/api/cast/design/save")).toBe(false);
  });

  it("saves under the description the candidate was made from, after a prompt and a confirmation", async () => {
    vi.stubGlobal("prompt", () => "Wick the ferryman");
    const asked: string[] = [];
    vi.stubGlobal("confirm", (words: string) => { asked.push(words); return true; });
    const { el, calls, saved, go } = panel(() => 0.01);
    await open(el);
    go.click();
    await tick(50);
    [...el.querySelectorAll(".previews button")].find((b: any) => b.textContent === "Use this voice").click();
    await tick(50);
    expect(asked[0]).toContain("This changes your account");
    expect(calls.find((c) => c.route === "/api/cast/design/save")!.body).toMatchObject({ id: "wick", generatedVoiceId: "GEN1", name: "Wick the ferryman", description: "A man's voice for a storybook." });
    expect(saved).toHaveLength(1);
  });
});

describe("the library search", () => {
  it("draws only the latest search: an earlier one that comes back late does not overwrite it", async () => {
    dom.document.body.innerHTML = '<details id="library"></details>';
    const finish: Record<string, () => void> = {};
    const call = (route: string, body: any) => new Promise((resolve) => {
      if (route !== "/api/voices/library") return resolve({});
      finish[body.search] = () => resolve({ voices: [{ id: body.search, ownerId: "o", name: body.search, about: "" }], hasMore: false });
    });
    mode.mountLibrary({ call, onAdded: async () => {} });
    const box = dom.document.getElementById("library");
    const search = box.querySelector("input");
    const go = [...box.querySelectorAll("button")].find((b: any) => b.textContent === "Search");
    search.value = "A";
    go.click();
    search.value = "B";
    go.click();
    // B answers first, then A, late.
    finish["B"]!();
    await tick();
    finish["A"]!();
    await tick();
    expect([...box.querySelectorAll(".found strong")].map((n: any) => n.textContent)).toEqual(["B"]);
  });
});
