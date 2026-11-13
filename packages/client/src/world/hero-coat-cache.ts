/**
 * The tinter's cache and its queue (docs/hero-looks.md §5.3): every tinted
 * painting a screen draws, made once, shared, and let go of by memory.
 *
 *   - **One pass per painting and paint.** Two surfaces asking for the same
 *     painting in the same colour at once share one pass and one entry; each
 *     entry makes its object URL (the DOM) and its Pixi texture on first ask,
 *     both from the pass's one image. Passes run one at a time, in order.
 *   - **The latest choice wins.** A surface asks through a `CoatSlot`, which
 *     wants one colour at a time. A new want supersedes the last: a pass
 *     nobody wants any more is cancelled if queued and stopped and thrown
 *     away if running, and a pass that finishes for a superseded want is
 *     never shown. Until the new colour is ready, the slot keeps showing what
 *     it showed (or the painting as painted, before anything), so no earlier
 *     colour can flash after a later one.
 *   - **Bounded by real memory.** Each entry counts its pixels (a 1024
 *     canvas about 4 MiB, a 1254 gear portrait about 6 MiB); the cache holds
 *     at most `COAT_CACHE_BUDGET`, evicting the least recently used first.
 *   - **What is drawn is kept.** A slot pins the entry it shows (a sprite's
 *     texture, a mounted image's URL); a pinned entry is never evicted, so
 *     the cache may go over its bound while those are held, and settles back
 *     once they are let go. Eviction revokes the object URL, destroys the
 *     texture and closes the image. The painting and mask are not held once
 *     the pass is done.
 *   - **A pass that fails** (a missing file, a mask off its canvas) is
 *     remembered for the page's life, and that hero draws as painted.
 *
 * `heroCoats()` is the page's cache; tests make their own with a runner of
 * their own (`new CoatCache`) or set one (`setHeroCoats`).
 */

import type { HeroCoatRequest } from "./hero-art";
import { defaultTintRunner, type TintImage, type TintRunner } from "./hero-coat-pass";
import { isTvBrowser } from "../display/tv";

const MIB = 1024 * 1024;

/** What the cache holds before it evicts: four heroes' world figures and portraits, and the book's preview (§5.3). */
export const COAT_CACHE_BUDGET = 48 * MIB;

/**
 * A television's bound: the shared screen shows each hero in one colour at a time and never
 * the book's preview, and its memory is the set-top box's (art-memory.ts).
 */
export const COAT_CACHE_BUDGET_TV = 16 * MIB;

/** A tinted painting, ready to draw. */
export interface CoatEntry {
  readonly key: string;
  /** Its pixels' size in bytes: what it counts against the bound. */
  readonly bytes: number;
  /** An object URL of it, made on first ask, revoked when it is evicted. */
  url(): string;
  /** A texture of it, made with `make` on first ask, destroyed with `destroy` when it is evicted. */
  texture<T>(make: (source: unknown) => T, destroy: (texture: T) => void): T;
}

/** One surface's want: one colour at a time, the latest winning. */
export interface CoatSlot {
  /** Ask for this tint (null: as painted). Shown through the slot's callback once ready. */
  want(request: HeroCoatRequest | null): void;
  /** The entry the slot shows now, pinned, or null (as painted). */
  readonly shown: CoatEntry | null;
  /** Let go of everything; the callback is not called again. */
  close(): void;
}

export interface CoatCacheOptions {
  runner: TintRunner;
  budget?: number;
  /** How an object URL is made and revoked (tests count them). */
  urls?: { create(blob: Blob): string; revoke(url: string): void };
}

interface Entry extends CoatEntry {
  pins: number;
  image: TintImage;
  objectUrl: string | null;
  evicted: boolean;
  made: { texture: unknown; destroy: (texture: unknown) => void } | null;
}

interface Want {
  slot: Slot;
  key: string;
}

interface Pass {
  request: HeroCoatRequest;
  wants: Set<Want>;
  controller: AbortController;
  started: boolean;
}

interface Slot extends CoatSlot {
  pending: Want | null;
  current: Entry | null;
  closed: boolean;
  /** `failed`: tell the surface even when it already shows nothing, so it can stop waiting. */
  show(entry: Entry | null, failed?: boolean): void;
}

export interface CoatCacheStats {
  /** Every entry's bytes. */
  total: number;
  /** Bytes of entries something shows. */
  pinned: number;
  /** Bytes of entries nothing shows: what the bound holds. */
  unpinned: number;
  entries: number;
  /** Passes queued or running. */
  passes: number;
}

export class CoatCache {
  private readonly runner: TintRunner;
  private readonly budget: number;
  private readonly urls: { create(blob: Blob): string; revoke(url: string): void };
  /** Least recently used first. */
  private readonly entries = new Map<string, Entry>();
  private readonly passes = new Map<string, Pass>();
  private readonly queue: Pass[] = [];
  private running: Pass | null = null;
  private readonly failed = new Set<string>();

  constructor({ runner, budget = COAT_CACHE_BUDGET, urls }: CoatCacheOptions) {
    this.runner = runner;
    this.budget = budget;
    this.urls = urls ?? { create: (blob) => URL.createObjectURL(blob), revoke: (url) => URL.revokeObjectURL(url) };
  }

  /** A ready entry, without pinning it: for a first render that will pin it at once. */
  peek(key: string): CoatEntry | null {
    return this.entries.get(key) ?? null;
  }

  /** Whether `key` is done: made, or failed for good (drawn as painted). Not waiting, not running. */
  settled(key: string): boolean {
    return this.entries.has(key) || this.failed.has(key);
  }

  stats(): CoatCacheStats {
    let total = 0;
    let pinned = 0;
    for (const entry of this.entries.values()) {
      total += entry.bytes;
      if (entry.pins > 0) pinned += entry.bytes;
    }
    return { total, pinned, unpinned: total - pinned, entries: this.entries.size, passes: this.passes.size };
  }

  /** A surface's want (see `CoatSlot`); `show` is told each entry it should draw, or null for as painted. */
  slot(show: (entry: CoatEntry | null) => void): CoatSlot {
    const cache = this;
    const slot: Slot = {
      pending: null,
      current: null,
      closed: false,
      get shown() {
        return slot.current;
      },
      show(entry, failed = false) {
        if (entry === slot.current && !failed) return;
        const was = slot.current;
        if (entry) cache.pin(entry);
        slot.current = entry;
        if (was) cache.unpin(was);
        show(entry);
      },
      want(request) {
        if (slot.closed) return;
        // Asked again for what it is already waiting for: keep waiting.
        if (request !== null && slot.pending?.key === request.key) return;
        cache.drop(slot);
        if (request === null || cache.failed.has(request.key)) {
          slot.show(null, request !== null);
          return;
        }
        if (slot.current?.key === request.key) return;
        const ready = cache.entries.get(request.key);
        if (ready) {
          slot.show(ready);
          return;
        }
        const want: Want = { slot, key: request.key };
        slot.pending = want;
        cache.passFor(request).wants.add(want);
        cache.pump();
      },
      close() {
        if (slot.closed) return;
        cache.drop(slot);
        slot.closed = true;
        const was = slot.current;
        slot.current = null;
        if (was) cache.unpin(was);
      },
    };
    return slot;
  }

  /** Evict everything nothing shows (a test's reset, or a page going to the background). */
  trimAll(): void {
    for (const entry of [...this.entries.values()]) if (entry.pins === 0) this.evict(entry);
  }

  private pin(entry: Entry): void {
    entry.pins += 1;
    // Most recently used last.
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
  }

  private unpin(entry: Entry): void {
    entry.pins -= 1;
    this.trim();
  }

  /** The slot no longer wants what it was waiting for: a pass nobody wants is cancelled. */
  private drop(slot: Slot): void {
    const want = slot.pending;
    if (!want) return;
    slot.pending = null;
    for (const [key, pass] of this.passes) {
      if (!pass.wants.delete(want) || pass.wants.size > 0) continue;
      this.passes.delete(key);
      const queued = this.queue.indexOf(pass);
      if (queued >= 0) this.queue.splice(queued, 1);
      pass.controller.abort();
    }
  }

  private passFor(request: HeroCoatRequest): Pass {
    let pass = this.passes.get(request.key);
    if (!pass) {
      pass = { request, wants: new Set(), controller: new AbortController(), started: false };
      this.passes.set(request.key, pass);
      this.queue.push(pass);
    }
    return pass;
  }

  private pump(): void {
    if (this.running) return;
    const pass = this.queue.shift();
    if (!pass) return;
    this.running = pass;
    pass.started = true;
    const { painting, mask, paint, size } = pass.request;
    void this.runner({ painting, mask, paint, ...(size !== undefined ? { size } : {}) }, pass.controller.signal)
      .then((image) => this.finish(pass, image))
      .catch(() => {
        if (!pass.controller.signal.aborted) {
          // Her latest choice cannot be made: she draws as painted, never in an older colour.
          this.failed.add(pass.request.key);
          for (const want of pass.wants) {
            if (want.slot.pending !== want || want.slot.closed) continue;
            want.slot.pending = null;
            want.slot.show(null, true);
          }
        }
      })
      .finally(() => {
        if (this.passes.get(pass.request.key) === pass) this.passes.delete(pass.request.key);
        this.running = null;
        this.pump();
      });
  }

  private finish(pass: Pass, image: TintImage): void {
    const live = [...pass.wants].filter((want) => want.slot.pending === want && !want.slot.closed);
    if (pass.controller.signal.aborted || live.length === 0) {
      // Stale: nobody wants this colour any more. Thrown away, never shown.
      closeImage(image);
      return;
    }
    const entry = this.entryOf(pass.request.key, image);
    this.entries.set(entry.key, entry);
    for (const want of live) {
      want.slot.pending = null;
      want.slot.show(entry);
    }
    this.trim();
  }

  private entryOf(key: string, image: TintImage): Entry {
    const urls = this.urls;
    const entry: Entry = {
      key,
      bytes: image.width * image.height * 4,
      pins: 0,
      image,
      objectUrl: null,
      evicted: false,
      made: null,
      url() {
        // Once evicted, never again: nothing would revoke it.
        if (entry.evicted) return entry.objectUrl ?? "";
        entry.objectUrl ??= urls.create(image.blob);
        return entry.objectUrl;
      },
      texture<T>(make: (source: unknown) => T, destroy: (texture: T) => void): T {
        if (!entry.made) entry.made = { texture: make(image.source), destroy: destroy as (texture: unknown) => void };
        return entry.made.texture as T;
      },
    };
    return entry;
  }

  /** Over the bound: evict the least recently used entry nothing shows, until under it or none is left. */
  private trim(): void {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.bytes;
    for (const entry of [...this.entries.values()]) {
      if (total <= this.budget) return;
      if (entry.pins > 0) continue;
      total -= entry.bytes;
      this.evict(entry);
    }
  }

  private evict(entry: Entry): void {
    this.entries.delete(entry.key);
    if (entry.objectUrl) this.urls.revoke(entry.objectUrl);
    entry.evicted = true;
    if (entry.made) entry.made.destroy(entry.made.texture);
    entry.made = null;
    closeImage(entry.image);
  }
}

function closeImage(image: TintImage): void {
  const source = image.source as { close?: () => void } | null;
  if (source && typeof source.close === "function") source.close();
}

let shared: CoatCache | null = null;

/** The page's cache, with the page's runner (a worker where it can, slices where not). */
export function heroCoats(): CoatCache {
  shared ??= new CoatCache({ runner: defaultTintRunner(), budget: isTvBrowser() ? COAT_CACHE_BUDGET_TV : COAT_CACHE_BUDGET });
  return shared;
}

/** Test seam: use this cache as the page's (null: a fresh default on next use). */
export function setHeroCoats(cache: CoatCache | null): void {
  shared = cache;
}
