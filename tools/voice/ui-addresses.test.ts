/**
 * The words the screens say outside a chapter's scenes (a prologue, a chapter's plate, an
 * epilogue, the help sheet) are played from recordings only if the address the screen asks for is
 * the address the inventory filed the recording under, in the manifest the client will fetch. The
 * screens build addresses with shared helpers; this checks them against the committed manifests,
 * so a change to either side that stops them meeting fails here and not at the table.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { endPlates, helpAddress, howToPlayAddress, manifestOfAddress, playlistFor, startPlates } from "@kad/shared";
import type { Campaign, Chapter, VoiceManifest } from "@kad/shared";
import { CONTENT, loadContent } from "./load";

const manifests = new Map<string, VoiceManifest>();
function manifestFor(address: string): VoiceManifest {
  const name = manifestOfAddress(address);
  expect(name, address).not.toBeNull();
  let loaded = manifests.get(name!);
  if (loaded === undefined) {
    loaded = JSON.parse(fs.readFileSync(path.join(CONTENT, "voice", "manifest", `${name!}.json`), "utf8")) as VoiceManifest;
    manifests.set(name!, loaded);
  }
  return loaded;
}

/** The clips a screen would play for one authored line at `address`: none means the device voice reads it. */
function clipsFor(address: string): number {
  return playlistFor([{ address, line: "" }], manifestFor(address))?.length ?? 0;
}

const content = loadContent();
const campaigns = content.campaigns as unknown as Campaign[];
const chapters = content.chapters as unknown as Chapter[];

describe("campaign plates are recorded where the screen looks", () => {
  it("finds a recording for every plate of every prologue, chapter plate and epilogue", () => {
    let plates = 0;
    for (const campaign of campaigns) {
      for (const chapter of chapters.filter((c) => c.campaignId === campaign.id)) {
        const picked = startPlates(campaign, chapter);
        if (picked === null) continue;
        expect(picked.addresses, `${campaign.id}/${chapter.id}`).toHaveLength(picked.plates.length);
        for (const address of picked.addresses ?? []) {
          expect(clipsFor(address), address).toBeGreaterThan(0);
          plates += 1;
        }
      }
      for (const epilogue of campaign.epilogues ?? []) {
        const picked = endPlates(campaign, epilogue.chapter, epilogue.endings[0] ?? null, "complete");
        expect(picked, `${campaign.id} epilogue ${epilogue.id}`).not.toBeNull();
        for (const address of picked?.addresses ?? []) {
          expect(clipsFor(address), address).toBeGreaterThan(0);
          plates += 1;
        }
      }
    }
    // Something was checked: the content really has plates.
    expect(plates).toBeGreaterThan(20);
  });
});

describe("the help sheet is recorded where the screen looks", () => {
  const help = content.help as unknown as {
    surfaces: Record<string, unknown>;
    things: Record<string, unknown>;
    howToPlay: unknown[];
  };

  it("finds a recording for every screen, every kind of thing and every How to play card", () => {
    const addresses = [
      ...Object.keys(help.surfaces).map((surface) => helpAddress(surface, null)),
      ...Object.keys(help.things).map((kind) => helpAddress("story", { kind })),
      ...help.howToPlay.map((_, i) => howToPlayAddress(i)),
    ];
    expect(addresses.length).toBeGreaterThan(15);
    for (const address of addresses) {
      expect(address).not.toBeNull();
      expect(clipsFor(address!), address!).toBeGreaterThan(0);
    }
  });
});
