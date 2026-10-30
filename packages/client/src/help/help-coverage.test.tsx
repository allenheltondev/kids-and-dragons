// @vitest-environment jsdom
/**
 * A player surface that ships without help fails here (#256).
 *
 * Three guards, from the outside in:
 *  1. every `data-surface` a screen declares is one this file knows the help for, so a new surface
 *     cannot appear without somebody deciding what its "?" says;
 *  2. every help id is reached by something real (`useHelpSurface`), and every one has words in
 *     content/help.json, in the voice, with an icon that exists;
 *  3. the sections the player can be in are all mapped.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { HELP_SURFACE_IDS, HELP_THING_KINDS, helpProblems, type HelpContent, type HelpSurfaceId, type PartyMember, type RunState } from "@kad/shared";
import { hasIcon } from "../screens/icons";
import { useGameStore } from "../store";
import { setPlayerSection } from "../store/player-navigation";
import { setHelpPane, useHelpFocus, useHelpSurface } from "./focus";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const help = JSON.parse(readFileSync(join(ROOT, "content", "help.json"), "utf8")) as HelpContent;

/**
 * Each `data-surface` a screen declares, and the help ids that cover what a player can be looking at
 * inside it. Add the new surface here and to HELP_SURFACE_IDS and content/help.json, or this fails.
 */
const COVERED_BY: Readonly<Record<string, readonly HelpSurfaceId[]>> = {
  player: ["story", "combat", "sheet", "inventory", "guide", "creation"],
  world: ["world"],
  map: ["map"],
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("every surface has help", () => {
  it("knows the help for every data-surface a screen declares", () => {
    const declared = new Set<string>();
    for (const file of sourceFiles(join(ROOT, "packages", "client", "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(/data-surface="([a-z-]+)"/g)) declared.add(match[1]!);
    }
    expect([...declared].sort()).toEqual(Object.keys(COVERED_BY).sort());
  });

  it("covers every help id once, and no id that does not exist", () => {
    const covered = Object.values(COVERED_BY).flat();
    expect([...covered].sort()).toEqual([...HELP_SURFACE_IDS].sort());
  });

  it("has words, in the voice, for every surface, thing and the join step", () => {
    expect(Object.keys(help.surfaces).sort()).toEqual([...HELP_SURFACE_IDS].sort());
    expect(Object.keys(help.things).sort()).toEqual([...HELP_THING_KINDS].sort());
    expect(helpProblems(help)).toEqual([]);
  });

  it("draws every entry with an icon that exists", () => {
    const entries = [...Object.values(help.surfaces), ...Object.values(help.things), help.join, ...help.howToPlay];
    for (const entry of entries) expect(hasIcon(entry.icon), entry.icon).toBe(true);
  });
});

function seat(over: Partial<RunState> | null): void {
  const me = { playerId: "p_1", character: { id: "c_1" } } as unknown as PartyMember;
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    state: over === null ? ({ party: [] } as unknown as RunState) : ({ party: [me], ...over } as unknown as RunState),
  });
}

describe("which surface the '?' names", () => {
  afterEach(() => {
    cleanup();
    setHelpPane("player");
    setPlayerSection("bag");
    useHelpFocus.setState({ claims: [], open: false, thing: null });
  });

  it("reaches every help id from the screen a player can really be on", () => {
    const { result } = renderHook(() => useHelpSurface());
    const seen = new Set<HelpSurfaceId>();
    const look = (): void => { seen.add(result.current); };

    act(() => { seat(null); setPlayerSection("bag"); });
    look(); // no hero yet
    expect(result.current).toBe("creation");

    act(() => { seat({}); setPlayerSection("bag"); });
    expect(result.current).toBe("inventory");
    look();
    act(() => { setPlayerSection("turn"); });
    expect(result.current).toBe("story");
    look();
    act(() => { seat({ encounter: {} as RunState["encounter"] }); });
    expect(result.current).toBe("combat");
    look();
    act(() => { useHelpFocus.setState({ claims: ["sheet"] }); });
    expect(result.current).toBe("sheet");
    look();
    act(() => { useHelpFocus.setState({ claims: [] }); setPlayerSection("guide"); });
    expect(result.current).toBe("guide");
    look();
    act(() => { setPlayerSection("bag"); setHelpPane("map"); });
    expect(result.current).toBe("map");
    look();
    // The world pane outranks anything left open behind it.
    act(() => { setHelpPane("world"); setPlayerSection("guide"); });
    expect(result.current).toBe("world");
    look();

    expect([...seen].sort()).toEqual([...HELP_SURFACE_IDS].sort());
  });
});
