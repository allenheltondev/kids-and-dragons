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
export * from "./types/state.js";
export * from "./types/protocol.js";

export * from "./rules.js";
export * from "./character.js";
export * from "./migrate.js";
export * from "./dice.js";
export * from "./inventory.js";
export * from "./chapter-graph.js";
export * from "./grid.js";
export * from "./engine.js";
export * from "./speak.js";
