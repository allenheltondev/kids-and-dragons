/**
 * The MCP server, built per request for one verified key (docs/mcp-server.md).
 * After content-tracking's functions/mcp/server.mjs, with scopes per area in
 * place of its single read/write level.
 *
 * A tool belongs to an area. A key with `<area>:write` gets every tool in it; a
 * key with `<area>:read` gets only the tools annotated readOnlyHint, and the
 * annotation is the single source of truth for that, as there. A tool the key
 * may not use is never registered: it is absent from tools/list, and calling it
 * is an unknown-tool error.
 */

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Area, Scope, VerifiedKey } from "./keys.ts";
import { READ, guarded } from "./shared.ts";
import type { TimingReader } from "../store/timing-store.ts";
import type { ChapterIndex } from "./chapter-index.ts";
import { registerAssetTools } from "./tools/assets.ts";
import { registerTimingTools } from "./tools/timing.ts";
import type { UploadSigner } from "./uploads.ts";

export const SERVER_INFO = { name: "kids-and-dragons", version: "1.0.0" };

/** The slice of McpServer the tool modules use, so a scoped view can stand in for it. */
export interface ToolRegistrar {
  registerTool: McpServer["registerTool"];
}

export interface ServerDeps {
  signer: UploadSigner;
  /** The session-timing table, for the operator's timing tools. Absent: they are not offered. */
  timing?: TimingReader;
  /** The chapters as built (mcp/chapter-index.ts): current revisions, plans, campaign order. */
  chapterIndex?: ChapterIndex | null;
  now?: () => number;
}

const INSTRUCTIONS =
  "Operate Kids & Dragons. Asset tools add art and audio to the content-addressed asset store: " +
  "npm run assets:push in the repo calls request_uploads and uploads for you. Timing tools (operator) say how long real " +
  "family tables take over chapters, mini-games and fights against the 30-minute budget: start with timing_overview, then " +
  "timing_findings for what to act on. whoami says what this key may do.";

export function buildServer(key: VerifiedKey, deps: ServerDeps): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: `${INSTRUCTIONS} This key may: ${key.scopes.join(", ") || "nothing"}.` });

  // Every key may ask who it is: the label, the scopes and when it runs out.
  server.registerTool(
    "whoami",
    {
      title: "Who am I",
      description: "This key's label, agent, tags, scopes and expiry. The label, agent and tags are stamped on every blob it uploads.",
      inputSchema: z.object({}),
      outputSchema: z.looseObject({ label: z.string(), scopes: z.array(z.string()), expires_at: z.string() }),
      annotations: READ,
    },
    guarded(async () => ({ label: key.label, agent: key.agent, tags: key.tags, scopes: key.scopes, expires_at: key.expiresAt })),
  );

  registerAssetTools(scoped(server, "assets", key.scopes), { signer: deps.signer, key });
  // Operator tools. Session timing holds no household, player or name (docs/session-timing.md),
  // so it needs no household-data review. Anything returning a household's data needs the
  // privacy review in #525 first: what a tool returns goes into a model's context.
  if (deps.timing) registerTimingTools(scoped(server, "operator", key.scopes), { reader: deps.timing, key, now: deps.now ?? Date.now, index: deps.chapterIndex ?? null });
  return server;
}

/** The tools of one area that these scopes reach; the rest are silently not registered. */
export function scoped(server: ToolRegistrar, area: Area, scopes: readonly Scope[]): ToolRegistrar {
  const write = scopes.includes(`${area}:write`);
  const read = write || scopes.includes(`${area}:read`);
  const registerTool = ((name: string, config: { annotations?: { readOnlyHint?: boolean } }, callback: unknown) => {
    if (write || (read && config.annotations?.readOnlyHint === true)) {
      return (server.registerTool as (...args: unknown[]) => unknown)(name, config, callback);
    }
    return undefined;
  }) as McpServer["registerTool"];
  return { registerTool };
}
