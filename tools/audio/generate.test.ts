/**
 * The generator's two testable halves: which jobs a command line means, and
 * that the briefs the game asks for and the jobs the tool builds are the same
 * list. The network and ffmpeg halves are not faked — a test that mocked both
 * would be measuring the fake, and both fail loudly with their own message.
 */

import { describe, expect, it } from "vitest";
import { CUE_SPECS, MUSIC_SPECS } from "../../packages/client/src/audio/paths";
import { audioJobs } from "./specs";
import { PROVIDERS, selectJobs } from "./generate";

describe("the job list", () => {
  it("is exactly what the game asks for", () => {
    // One list, read from the client's own table — a second copy would be a
    // second answer to "what cues exist".
    const jobs = audioJobs();
    expect(jobs).toHaveLength(Object.keys(CUE_SPECS).length + Object.keys(MUSIC_SPECS).length);
    for (const id of Object.keys(CUE_SPECS)) {
      expect(jobs.find((job) => job.id === id)?.file).toBe(`cues/${id}.webm`);
    }
    for (const id of Object.keys(MUSIC_SPECS)) {
      expect(jobs.find((job) => job.selector === `music:${id}`)?.kind).toBe("music");
    }
  });

  it("gives every job a brief and a length to prompt with", () => {
    for (const job of audioJobs()) {
      expect(job.brief.length).toBeGreaterThan(20);
      expect(job.seconds).toBeGreaterThan(0);
    }
  });

  it("splits sfx from music, because they are different endpoints", () => {
    // A sound-effects model asked for 45s of ambience returns 45s of noise.
    const kinds = new Set(audioJobs().map((job) => job.kind));
    expect(kinds).toEqual(new Set(["sfx", "music"]));
  });
});

describe("selecting jobs", () => {
  const jobs = audioJobs();

  it("means everything when nothing is named", () => {
    expect(selectJobs(jobs, [])).toHaveLength(jobs.length);
  });

  it("takes a cue by id and a loop by its music: selector", () => {
    const picked = selectJobs(jobs, ["dice", "music:forest"]);
    expect(picked.map((job) => job.selector).sort()).toEqual(["dice", "music:forest"]);
  });

  it("matches nothing for a name that is not a cue", () => {
    // The CLI turns this into an exit rather than silently generating the lot.
    expect(selectJobs(jobs, ["kazoo"])).toEqual([]);
  });
});

describe("providers", () => {
  it("names at least one, and the seam is a plain function", () => {
    const names = Object.keys(PROVIDERS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(typeof PROVIDERS[name]).toBe("function");
  });
});
