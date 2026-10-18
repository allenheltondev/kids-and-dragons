/**
 * @kad/shared — the contract between client and server.
 *
 * Types are the coordination surface: the server owns authority, the client
 * owns presentation, and both agree here. Engine logic lives here too so that
 * dice and rules resolution have exactly one implementation, running on the
 * server (spec §"Server-authoritative") and available to the client for
 * previewing what a change *would* do.
 */

export * from "./types/domain.js";
export * from "./types/chapter.js";
export * from "./types/campaign-graph.js";
export * from "./types/buffs.js";
export * from "./types/state.js";
export * from "./types/protocol.js";
export * from "./types/world.js";

export * from "./rules.js";
export * from "./character.js";
export * from "./claim.js";
export * from "./player-colors.js";
export * from "./migrate.js";
export * from "./field-guide-record.js";
export * from "./dice.js";
export * from "./inventory.js";
export * from "./bestiary.js";
export * from "./field-guide.js";
export * from "./discoveries.js";
export * from "./chapter-graph.js";
export * from "./chapter-pacing.js";
export * from "./narration.js";
export * from "./routes.js";
export * from "./campaign-graph.js";
export * from "./journey.js";
export * from "./rifts.js";
export * from "./rift-actions.js";
export * from "./campaign-graph-lint.js";
export * from "./campaign-prerequisites.js";
export * from "./practice.js";
export * from "./world-state.js";
export * from "./buffs.js";
export * from "./chapter-map.js";
export * from "./grid.js";
export * from "./encounter.js";
export * from "./environment.js";
export * from "./engine.js";
export * from "./away.js";
export * from "./enemy-ai.js";
export * from "./balance.js";
export * from "./playtest.js";
export * from "./speak.js";
export * from "./preview.js";
export * from "./visitors.js";
export * from "./names.js";
