/**
 * The generator's two testable halves: which jobs a command line means, and
 * that the briefs the game asks for and the jobs the tool builds are the same
 * list. The network and ffmpeg halves are not faked — a test that mocked both
 * would be measuring the fake, and both fail loudly with their own message.
 */

import { describe, expect, it } from "vitest";
import { CUE_SPECS, MUSIC_SPECS } from "../../packages/client/src/audio/paths";
import { audioJobs } from "./specs";
import { PROVIDERS, runJobs, selectJobs } from "./generate";

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

describe("what a run reports", () => {
  const jobs = selectJobs(audioJobs(), ["dice", "tap"]);
  const io = (overrides: Partial<Parameters<typeof runJobs>[2]> = {}) => ({
    exists: () => false,
    write: () => undefined,
    force: false,
    log: () => undefined,
    ...overrides,
  });

  it("counts what it wrote", async () => {
    const outcome = await runJobs(jobs, async () => Buffer.from("audio"), io());
    expect(outcome).toEqual({ made: 2, failed: [] });
  });

  it("names every job that failed, so the caller can exit non-zero", async () => {
    /*
     * The bug this pins: the loop printed "failed" per job and then returned
     * normally, so a run killed by a bad key, a provider outage or an ffmpeg
     * rejection still told the shell it had succeeded. A person reads the
     * word; a script reads the exit code, and the two disagreed.
     */
    const outcome = await runJobs(jobs, async () => {
      throw new Error("401 unauthorized");
    }, io());
    expect(outcome.made).toBe(0);
    expect(outcome.failed).toEqual(["dice", "tap"]);
  });

  it("keeps going after one job dies", async () => {
    // One dead cue must not take the other twelve down with it.
    let first = true;
    const outcome = await runJobs(jobs, async () => {
      if (first) {
        first = false;
        throw new Error("provider hiccup");
      }
      return Buffer.from("audio");
    }, io());
    expect(outcome.made).toBe(1);
    expect(outcome.failed).toEqual(["dice"]);
  });

  it("skipping an existing file is not a failure", async () => {
    // Re-running without --force is the ordinary way to top up a half-done
    // set; it must not look like an error to a script.
    const outcome = await runJobs(jobs, async () => Buffer.from("audio"), io({ exists: () => true }));
    expect(outcome).toEqual({ made: 0, failed: [] });
  });

  it("counts an encode failure as a failure, not a write", async () => {
    const outcome = await runJobs(jobs.slice(0, 1), async () => Buffer.from("audio"), io({
      write: () => {
        throw new Error("ffmpeg failed: Invalid data found");
      },
    }));
    expect(outcome).toEqual({ made: 0, failed: ["dice"] });
  });
});
