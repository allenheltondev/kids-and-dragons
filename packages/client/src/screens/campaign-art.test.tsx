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
  it("shows the campaign's painting, and a plain panel if it cannot load", () => {
    const { container } = render(<CampaignArt campaignId="riftlight" />);
    const img = () => container.querySelector("img");
    expect(img()?.getAttribute("src")).toBe("/assets/campaigns/riftlight.webp");
    fireEvent.error(img()!);
    expect(img()).toBeNull();
  });

  it("looks for every painting the manifest declares, where it declares it", () => {
    for (const id of manifest.campaignArt.campaigns) {
      expect(campaignArtSources(id)).toEqual([`/assets/campaigns/${id}.webp`]);
    }
  });

  it("keeps an unknown campaign on the existing missing-art fallback", () => {
    expect(campaignArtSources("unknown-campaign")).toEqual(["/assets/campaigns/unknown-campaign.webp"]);
  });

  it("ships every painting it declares", () => {
    for (const id of manifest.campaignArt.campaigns) {
      expect(existsSync(campaignArtSources(id)[0]!.slice(1)), id).toBe(true);
    }
  });
});
