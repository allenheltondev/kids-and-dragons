// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { existsSync } from "node:fs";
import { CampaignArt, campaignArtSources } from "./CampaignArt";

import manifest from "../../../../assets/manifest.json";

afterEach(() => {
  cleanup();
});

describe("a campaign's key art", () => {
  it("tries the campaign's own painting, then a scene from its story, then nothing", () => {
    const { container } = render(<CampaignArt campaignId="gemfall" />);
    const img = () => container.querySelector("img");
    expect(img()?.getAttribute("src")).toBe("/assets/campaigns/gemfall.webp");
    fireEvent.error(img()!);
    expect(img()?.getAttribute("src")).toBe("/assets/scenes/gemfall/redspire-citadel.webp");
    fireEvent.error(img()!);
    expect(img()).toBeNull();
  });

  it("looks for every painting the manifest declares, where it declares it", () => {
    for (const id of manifest.campaignArt.campaigns) {
      expect(campaignArtSources(id)[0]).toBe(`/assets/campaigns/${id}.webp`);
    }
  });

  it("has no stand-in for a campaign nobody painted for", () => {
    expect(campaignArtSources("the-hollow-crown")).toEqual(["/assets/campaigns/the-hollow-crown.webp"]);
  });

  it("only stands in with scenes that exist", () => {
    for (const id of ["gemfall", "riftlight", "riftlight-opening-preview"]) {
      for (const source of campaignArtSources(id).slice(1)) {
        expect(existsSync(source.slice(1)), source).toBe(true);
      }
    }
  });
});
