import { useState } from "react";
import type { ReactElement } from "react";
import "./CampaignArt.css";

/**
 * A campaign's key art, for the lobby's adventure cards: one 16:9 painting per
 * campaign at `assets/campaigns/<id>.webp` (`manifest.campaignArt`).
 *
 * Until a campaign's own painting lands, a scene from its story stands in, and
 * past that a plain panel: the card still reads by its title. A placeholder can
 * go once the real file ships, since the real file is always tried first.
 */
const PLACEHOLDERS: Readonly<Record<string, string>> = {
  // The local story preview (`npm run riftlight:preview`) plays under its own id.
  "riftlight-opening-preview": "campaigns/riftlight",
};

export function campaignArtUrl(campaignId: string): string {
  return `/assets/campaigns/${campaignId}.webp`;
}

/** Where to look, in order: the campaign's own art, then its stand-in. */
export function campaignArtSources(campaignId: string): string[] {
  const placeholder = PLACEHOLDERS[campaignId];
  return [campaignArtUrl(campaignId), ...(placeholder ? [`/assets/${placeholder}.webp`] : [])];
}

/** Decoration only: the card's title says what it is. */
export function CampaignArt({ campaignId }: { campaignId: string }): ReactElement {
  const sources = campaignArtSources(campaignId);
  // Keyed by campaign, so a list that reorders never shows one card's
  // fallback on another.
  const [failed, setFailed] = useState<{ id: string; count: number }>({ id: campaignId, count: 0 });
  const tried = failed.id === campaignId ? failed.count : 0;
  const src = sources[tried];
  return (
    <div className="campaign-art" aria-hidden="true" data-campaign-art={campaignId}>
      {src === undefined ? null : (
        <img
          key={src}
          className="campaign-art__image"
          src={src}
          alt=""
          decoding="async"
          onError={() => setFailed({ id: campaignId, count: tried + 1 })}
        />
      )}
    </div>
  );
}
