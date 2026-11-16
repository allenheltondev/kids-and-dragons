import { campView } from "@kad/shared";
import type { CampCatalog, CampRecord } from "@kad/shared";
import type { ContentStore } from "../content/loader.ts";

export function campSources(camp: CampRecord, catalog: CampCatalog, content: Pick<ContentStore, "chapter" | "campaign">): Record<string, string> {
  const sources: Record<string, string> = {};
  for (const [pieceId, owned] of Object.entries(camp.owned)) {
    if (owned.from === "bought") sources[pieceId] = "Bought with Dash Cash";
    else if (owned.from === "kept") sources[pieceId] = "Your crew's very own";
    else {
      const place = owned.rewardId ? offerPlace(owned.rewardId, catalog, content) : null;
      sources[pieceId] = place ? `Found ${place}` : "Found on an adventure";
    }
  }
  // What a spot shows until the crew places something: its frame's own piece, or the crew's banner.
  for (const spot of catalog.hotspots) {
    if (!spot.default || spot.stage > camp.frameStage || sources[spot.default]) continue;
    const piece = catalog.crewPieces.find((p) => p.id === spot.default);
    sources[spot.default] = piece?.group === "kept" ? "Your crew's very own" : "Came with your camp";
  }
  for (const piece of catalog.crewPieces) {
    if (piece.group === "trophy" && camp.grownBy.includes(piece.campaign)) {
      sources[piece.id] = `For finishing ${content.campaign(piece.campaign)?.title ?? "a whole adventure"}`;
    }
  }
  return sources;
}

export function offerPlace(rewardId: string, catalog: CampCatalog, content: Pick<ContentStore, "chapter" | "campaign">): string | null {
  const offers = [
    ...catalog.crewPieces.flatMap((p) => (p.group === "find" ? p.offers : [])),
    ...catalog.kit.decorations.flatMap((d) => (d.group === "find" ? d.offers : [])),
    ...catalog.friends.flatMap((f) => f.offers),
  ];
  const offer = offers.find((o) => o.rewardId === rewardId);
  const chapter = offer ? content.chapter(offer.chapter) : null;
  if (!chapter) return null;
  const graph = content.campaign(chapter.campaignId)?.graph;
  const node = graph ? Object.values(graph.nodes).find((n) => n.chapter === chapter.id) : undefined;
  if (node?.title) return `at ${node.title.startsWith("The ") ? `the ${node.title.slice(4)}` : `the ${node.title}`}`;
  return `in “${chapter.title}”`;
}


export function campWithSources(camp: CampRecord, content: Pick<ContentStore, "chapter" | "campaign" | "campCatalog">) {
  const catalog = content.campCatalog();
  return { ...campView(camp), ...(catalog ? { sources: campSources(camp, catalog, content) } : {}) };
}
