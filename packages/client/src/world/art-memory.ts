/**
 * The world's painted art in memory: what a television's browser can afford to keep.
 *
 * Pixi's `Assets.load` keeps every texture it ever loaded, decoded, for the page's life: a
 * 1024 figure is 4 MiB, a 1920x1080 backdrop 8 MiB, a rift's sheet nearly 10 MiB, and a
 * chapter walks past dozens of them. A laptop shrugs; a set-top box runs out of memory a
 * chapter in and starts dropping frames, then whole textures (the "jumbled" playtest).
 *
 * So the stage's art goes through here instead:
 *
 *   - `loadArt(url)` is `Assets.load` that remembers the URL, most recently asked last.
 *   - `holdArt(url)` keeps a URL loaded while something means to draw it soon (the scenes
 *     ahead, art-prefetch.ts; a camp's own pieces). The returned function lets go.
 *   - `sweepArt(stage)`, run a moment after the scene changes, walks what the stage is
 *     drawing right now and unloads every remembered texture it is not, newest kept first,
 *     until what is left undrawn (held or not) fits `idleArtBudget()`. Held art is never
 *     unloaded; it only uses the budget up first.
 *
 * Only art loaded here is ever swept. A cache that keeps a texture of its own between draws
 * (a tile sheet, a rift's frames) asks `artLoaded` before reusing it, and loads again when
 * the sweep took it. Hero paintings, the tinter's textures (hero-coat-cache.ts) and
 * nameplate frames keep their own lifecycles and never come through here.
 */

import { Assets, type Texture } from "pixi.js";
import { isTvBrowser } from "../display/tv";

const MIB = 1024 * 1024;

/**
 * Undrawn art kept decoded: what the scenes ahead and a step back cost. On a television,
 * about four backdrops' worth; elsewhere enough that a laptop never reloads a thing.
 */
export const IDLE_ART_BUDGET = { tv: 32 * MIB, other: 160 * MIB } as const;

export function idleArtBudget(tv: boolean = isTvBrowser()): number {
  return tv ? IDLE_ART_BUDGET.tv : IDLE_ART_BUDGET.other;
}

/** Every URL loaded here, least recently asked first (a Map keeps insertion order). */
const known = new Map<string, true>();
const holds = new Map<string, number>();
/** URLs with a load still in flight, by how many. */
const pending = new Map<string, number>();

function touch(url: string): void {
  known.delete(url);
  known.set(url, true);
}

/**
 * `Assets.load`, remembered for the sweep. A texture the sweep unloaded between a cache hit
 * and its use comes back destroyed; that one is loaded once more.
 */
export function loadArt(url: string): Promise<Texture> {
  touch(url);
  pending.set(url, (pending.get(url) ?? 0) + 1);
  const done = () => {
    const left = (pending.get(url) ?? 1) - 1;
    if (left > 0) pending.set(url, left);
    else pending.delete(url);
  };
  return Assets.load<Texture>(url)
    .then((texture) => (texture.destroyed ? Assets.load<Texture>(url) : texture))
    .then(
      (texture) => {
        done();
        // Remembered again now that it is decoded, as the newest: a sweep that ran while it
        // was loading must not have lost it, or it would sit in Pixi's cache for good.
        touch(url);
        return texture;
      },
      (error: unknown) => {
        done();
        throw error;
      },
    );
}

/** Keep `url` through sweeps until the returned function is called (once is enough; twice is harmless). */
export function holdArt(url: string): () => void {
  touch(url);
  holds.set(url, (holds.get(url) ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = (holds.get(url) ?? 1) - 1;
    if (left > 0) holds.set(url, left);
    else holds.delete(url);
  };
}

/** Whether `url` is loaded now and not unloaded since: a cached slice of it is still good. */
export function artLoaded(url: string): boolean {
  if (!Assets.cache.has(url)) return false;
  const texture = Assets.cache.get<Texture>(url);
  return texture !== undefined && !texture.destroyed;
}

/** The part of a display object the sweep reads: what it draws, and its children. */
export interface DrawnNode {
  readonly texture?: { readonly source?: unknown } | null;
  readonly children?: readonly DrawnNode[];
  readonly mask?: unknown;
  readonly destroyed?: boolean;
}

/** Every texture source under `root`, visible or not: hidden is not the same as gone. */
export function drawnSources(root: DrawnNode, into: Set<unknown> = new Set()): Set<unknown> {
  const stack: DrawnNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.destroyed) continue;
    const source = node.texture?.source;
    if (source) into.add(source);
    const mask = node.mask as DrawnNode | null | undefined;
    if (mask && typeof mask === "object" && "children" in mask) stack.push(mask);
    if (node.children) for (const child of node.children) stack.push(child);
  }
  return into;
}

/** What `sweepArt` read and did, for a dev console and the tests. */
export interface ArtSweep {
  /** URLs unloaded. */
  released: string[];
  /** Bytes still decoded and undrawn after the sweep (held art included). */
  idleBytes: number;
  /** Bytes the stage is drawing. */
  drawnBytes: number;
}

/** How the sweep reaches Pixi's cache; a test passes its own. */
export interface ArtCache {
  get(url: string): Texture | undefined;
  unload(url: string): void;
}

const pixiCache: ArtCache = {
  get: (url) => (Assets.cache.has(url) ? Assets.cache.get<Texture>(url) : undefined),
  unload: (url) => void Assets.unload(url).catch(() => undefined),
};

function bytesOf(texture: Texture): number {
  const source = texture.source as { pixelWidth?: number; pixelHeight?: number; width?: number; height?: number } | undefined;
  if (!source) return 0;
  return (source.pixelWidth ?? source.width ?? 0) * (source.pixelHeight ?? source.height ?? 0) * 4;
}

/**
 * Unload the remembered art `roots` do not draw, oldest first, until what is left undrawn
 * fits `budget`. Held art is kept whatever it costs, and counted first.
 */
export function sweepArt(roots: DrawnNode | readonly DrawnNode[], budget: number = idleArtBudget(), cache: ArtCache = pixiCache): ArtSweep {
  const drawn = new Set<unknown>();
  for (const root of Array.isArray(roots) ? roots : [roots as DrawnNode]) drawnSources(root, drawn);
  const result: ArtSweep = { released: [], idleBytes: 0, drawnBytes: 0 };
  const idle: { url: string; bytes: number }[] = [];
  const counted = new Set<unknown>();
  // Newest first, so a budget that runs out lets go of what was asked for longest ago.
  for (const url of [...known.keys()].reverse()) {
    const texture = cache.get(url);
    // Still loading: nothing decoded to let go of yet, and kept so a later sweep can. A
    // failed one is forgotten so the list cannot grow with every missing file.
    if (!texture) {
      if (!holds.has(url) && !pending.has(url)) known.delete(url);
      continue;
    }
    if (texture.destroyed) {
      known.delete(url);
      continue;
    }
    const bytes = bytesOf(texture);
    if (drawn.has(texture.source)) {
      if (!counted.has(texture.source)) result.drawnBytes += bytes;
      counted.add(texture.source);
      continue;
    }
    if (holds.has(url)) {
      result.idleBytes += bytes;
      continue;
    }
    idle.push({ url, bytes });
  }
  for (const { url, bytes } of idle) {
    if (result.idleBytes + bytes <= budget) {
      result.idleBytes += bytes;
      continue;
    }
    known.delete(url);
    cache.unload(url);
    result.released.push(url);
  }
  return result;
}

/** Test seam: forget every URL and hold. */
export function resetArtMemory(): void {
  known.clear();
  holds.clear();
  pending.clear();
}
