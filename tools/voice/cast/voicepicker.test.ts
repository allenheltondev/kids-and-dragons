// @vitest-environment jsdom
/**
 * The picker for a long list of ElevenLabs voices (mode.ts), run in a DOM as the cast pages run it: a search that
 * narrows the list, a list built only when somebody reaches for it, a free preview of each voice's own sample,
 * and the pick handed back to the page.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MODE_SCRIPT } from "./mode.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- the script is plain JavaScript with no types of its own. */
const mode = new Function(`${MODE_SCRIPT}\nreturn KadMode;`)() as any;

const options = [
  { value: "", label: "No voice yet: pick one" },
  { value: "v1", label: "Rachel · premade, american, female", preview: "https://example.test/rachel.mp3" },
  { value: "v2", label: "Adam · premade, american, male" },
  { value: "v3", label: "Charlotte · professional, british, female", preview: "https://example.test/charlotte.mp3" },
];

// The tools project has no DOM types, and this is the one test that needs a DOM: so it reaches it through the global.
const dom = globalThis as any;
const event = (name: string, init: Record<string, unknown> = {}): unknown => new dom.Event(name, init);

const picker = (value = "", onPick: (v: string) => void = () => undefined) => {
  const el = mode.voicePicker({ options, value, label: "Voice", onPick });
  dom.document.body.append(el);
  return {
    el,
    search: el.querySelector("input") as any,
    select: el.querySelector("select") as any,
    preview: el.querySelector("button") as any,
    count: el.querySelector(".hint") as any,
    values: (): string[] => [...el.querySelector("select").options].map((o: any) => o.value),
  };
};

const type = (input: any, text: string) => {
  input.value = text;
  input.dispatchEvent(event("input", { bubbles: true }));
};

afterEach(() => {
  dom.document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("the voice picker", () => {
  it("starts with only the voice they have, and says how many it can search", () => {
    const { search, values, select } = picker("v2");
    expect(values()).toEqual(["", "v2"]);
    expect(select.value).toBe("v2");
    expect(search.placeholder).toBe("Search 3 voices: name, accent, gender, age…");
    expect(search.getAttribute("aria-label")).toBe("Search ElevenLabs voices");
    expect(select.getAttribute("aria-label")).toBe("Voice");
  });

  it("builds the whole list when the list is reached for", () => {
    const { select, values } = picker("v2");
    select.dispatchEvent(event("focus"));
    expect(values()).toEqual(["", "v1", "v2", "v3"]);
    expect(select.value).toBe("v2");
  });

  it("narrows the list as you type, says how many are left, and keeps the voice they have", () => {
    const { search, values, count, select } = picker("v2");
    // Rachel and Charlotte match; Adam is male but is the voice they have, so he stays too.
    type(search, "female");
    expect(values()).toEqual(["", "v1", "v2", "v3"]);
    type(search, "british");
    expect(values()).toEqual(["", "v2", "v3"]);
    expect(count.textContent).toBe("2 of 3");
    expect(select.value).toBe("v2");
    type(search, "");
    expect(values()).toEqual(["", "v1", "v2", "v3"]);
    expect(count.textContent).toBe("");
  });

  it("hands the pick back, and a blank takes it back", () => {
    const onPick = vi.fn();
    const { search, select } = picker("", onPick);
    type(search, "charlotte");
    select.value = "v3";
    select.dispatchEvent(event("change"));
    expect(onPick).toHaveBeenLastCalledWith("v3");
    select.value = "";
    select.dispatchEvent(event("change"));
    expect(onPick).toHaveBeenLastCalledWith("");
  });

  it("previews a voice's own sample, stops it on a second press, and has nothing to play for a voice without one", () => {
    const played: string[] = [];
    class FakeAudio {
      src: string;
      paused = true;
      constructor(src: string) {
        this.src = src;
      }
      addEventListener() {}
      pause() {
        this.paused = true;
      }
      play() {
        this.paused = false;
        played.push(this.src);
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    const { search, select, preview } = picker("v1");
    expect(preview.disabled).toBe(false);
    expect(preview.title).toBe("Hear this voice's own sample (free)");
    preview.click();
    expect(played).toEqual(["https://example.test/rachel.mp3"]);
    expect(preview.textContent).toBe("■ Stop");
    preview.click();
    expect(preview.textContent).toBe("▶ Preview");
    expect(played).toHaveLength(1);
    // Adam has no sample, so there is nothing to play, and the button says so.
    type(search, "adam");
    select.value = "v2";
    select.dispatchEvent(event("change"));
    expect(preview.disabled).toBe(true);
    expect(preview.title).toBe("This voice has no sample to play");
  });
});
