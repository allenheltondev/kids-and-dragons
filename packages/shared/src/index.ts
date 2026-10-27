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
export * from "./types/matchups.js";

export * from "./rules.js";
export * from "./character.js";
export * from "./class-place.js";
export * from "./deeds.js";
export * from "./tokens.js";
export * from "./claim.js";
export * from "./player-colors.js";
export * from "./migrate.js";
export * from "./field-guide-record.js";
export * from "./kid-profile.js";
export * from "./dice.js";
export * from "./inventory.js";
export * from "./bestiary.js";
export * from "./matchups.js";
export * from "./field-guide.js";
export * from "./discoveries.js";
export * from "./chapter-graph.js";
export * from "./chapter-pacing.js";
export * from "./chapter-goal.js";
export * from "./chapter-preface.js";
export * from "./session-timing.js";
export * from "./story-plates.js";
export * from "./story-so-far.js";
export * from "./narration.js";
export * from "./routes.js";
export * from "./campaign-graph.js";
export * from "./journey.js";
export * from "./rifts.js";
export * from "./rift-actions.js";
export * from "./campaign-graph-lint.js";
export * from "./graph-proof.js";
export * from "./campaign-prerequisites.js";
export * from "./practice.js";
export * from "./world-state.js";
export * from "./buffs.js";
export * from "./chapter-map.js";
export * from "./grid.js";
export * from "./encounter.js";
export * from "./environment.js";
export * from "./engine.js";
export * from "./seats.js";
export * from "./away.js";
export * from "./prompt-for.js";
export * from "./push.js";
export * from "./spectators.js";
export * from "./enemy-ai.js";
export * from "./balance.js";
export * from "./playtest.js";
export * from "./speak.js";
export * from "./help.js";
export * from "./preview.js";
export * from "./visitors.js";
export * from "./names.js";
export * from "./interactions.js";
export * from "./figure-size.js";
export * from "./error-report.js";
