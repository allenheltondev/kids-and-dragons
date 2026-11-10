/**
 * A content tree held in memory: what `validateContent` judges.
 *
 * Every JSON file the gate reads is here by its repo-relative path
 * (`content/chapters/bramblewood-01.json`, `schemas/chapter.schema.json`,
 * `assets/manifest.json`), as text and, on demand, parsed. `ContentSet.load`
 * reads a tree from disk once; `clone` is cheap (the files are shared, never
 * copied), so a test loads the real tree once and breaks one thing in a clone.
 *
 * Text is the stored form because the gate reads some files both ways: a
 * campaign is parsed and also scanned as text for a repeated key, which
 * `JSON.parse` would silently merge. `json()` parses once per file and shares
 * the result between clones, so nothing that reads a set may change what it
 * returns (validate-content.test.ts holds the gate to that with a frozen set).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The directories `load` reads, with everything under them. */
const LOADED_DIRS = ["content", "schemas"];
/** Single files `load` reads besides. */
const LOADED_FILES = ["assets/manifest.json"];

interface Entry {
  readonly text: string;
  /** Filled by the first `json()`: the value, or the error `JSON.parse` threw. */
  parsed?: { value: unknown } | { error: unknown };
}

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

export class ContentSet {
  #files = new Map<string, Entry>();
  #dirs = new Set<string>();
  /** Files taken out of this set, so a probe of the disk does not find them again. */
  #removed = new Set<string>();
  /** Where files the set does not hold (a painting, a map tile) are looked for. */
  #root: string | null = null;
  /** What the disk said, per path. Shared with clones: the disk is the same one. */
  #probed = new Map<string, boolean>();

  /** Reads a tree from disk: `content/`, `schemas/` and the asset manifest. */
  static load(root: string): ContentSet {
    const set = new ContentSet();
    set.#root = root;
    const walk = (dir: string): void => {
      const abs = join(root, dir);
      if (!existsSync(abs)) return;
      set.#dirs.add(dir);
      for (const entry of readdirSync(abs, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".json")) set.#files.set(path, { text: readFileSync(join(root, path), "utf8") });
      }
    };
    for (const dir of LOADED_DIRS) walk(dir);
    for (const path of LOADED_FILES) {
      if (existsSync(join(root, path))) set.#put(path, { text: readFileSync(join(root, path), "utf8") });
    }
    return set;
  }

  /** A copy that can be changed without touching this one. The file contents are shared. */
  clone(): ContentSet {
    const copy = new ContentSet();
    copy.#files = new Map(this.#files);
    copy.#dirs = new Set(this.#dirs);
    copy.#removed = new Set(this.#removed);
    copy.#root = this.#root;
    copy.#probed = this.#probed;
    return copy;
  }

  #put(path: string, entry: Entry): void {
    this.#files.set(path, entry);
    this.#removed.delete(path);
    for (let dir = parentOf(path); dir; dir = parentOf(dir)) this.#dirs.add(dir);
  }

  /** Whether the set holds this JSON file. */
  has(path: string): boolean {
    return this.#files.has(path);
  }

  /** Whether the directory is there, empty or not. */
  hasDir(dir: string): boolean {
    return this.#dirs.has(dir);
  }

  /**
   * Whether any file is at this path: one the set holds, or one on the disk
   * the set was loaded from (the world map's painting and tiles are megabytes
   * of image nothing here reads, so only their presence is asked).
   */
  exists(path: string): boolean {
    if (this.#files.has(path)) return true;
    if (this.#removed.has(path) || this.#root === null) return false;
    let found = this.#probed.get(path);
    if (found === undefined) {
      found = existsSync(join(this.#root, path));
      this.#probed.set(path, found);
    }
    return found;
  }

  /** The `.json` files directly in a directory, sorted as `readdirSync().sort()` sorts them. */
  list(dir: string): string[] {
    const prefix = `${dir}/`;
    const names: string[] = [];
    for (const path of this.#files.keys()) {
      if (path.startsWith(prefix) && !path.includes("/", prefix.length)) names.push(path.slice(prefix.length));
    }
    return names.sort().map((name) => prefix + name);
  }

  /** Every path the set holds. */
  paths(): string[] {
    return [...this.#files.keys()];
  }

  #entry(path: string): Entry {
    const entry = this.#files.get(path);
    if (!entry) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    return entry;
  }

  /** The file as text. Throws when the set does not hold it. */
  text(path: string): string {
    return this.#entry(path).text;
  }

  /**
   * The file parsed. Throws what `JSON.parse` throws, every time it is asked.
   * The value is shared with every clone and every other reader: do not change it.
   */
  json(path: string): unknown {
    const entry = this.#entry(path);
    if (!entry.parsed) {
      try {
        entry.parsed = { value: JSON.parse(entry.text) };
      } catch (error) {
        entry.parsed = { error };
      }
    }
    if ("error" in entry.parsed) throw entry.parsed.error;
    return entry.parsed.value;
  }

  /** The file parsed afresh: a value the caller owns and may change. */
  readJson(path: string): unknown {
    return JSON.parse(this.text(path));
  }

  writeText(path: string, text: string): void {
    this.#put(path, { text });
  }

  /** Stores the value as a file on disk would hold it, so `undefined` and the like read back as JSON does. */
  writeJson(path: string, value: unknown): void {
    this.writeText(path, JSON.stringify(value, null, 2));
  }

  remove(path: string): void {
    this.#files.delete(path);
    this.#removed.add(path);
  }
}
