/**
 * Building blocks for the MCP tool modules (docs/mcp-server.md), after
 * content-tracking's functions/mcp/shared.mjs: annotation presets, and
 * `guarded`, which turns a tool body into structuredContent plus the same JSON
 * as text, and failures into `isError` results the model can read and act on.
 */

import { z } from "zod";

export const READ = { readOnlyHint: true, openWorldHint: false } as const;
export const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export const anyObject = z.looseObject({});

/** An error whose message is safe, and useful, to show the model. */
export class ToolError extends Error {}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export function guarded<A>(fn: (args: A) => Promise<Record<string, unknown>>): (args: A) => Promise<ToolResult> {
  return async (args: A) => {
    try {
      const data = await fn(args);
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      let message: string;
      if (error instanceof ToolError) message = error.message;
      else {
        console.error(JSON.stringify({ msg: "MCP tool failed", error: error instanceof Error ? error.stack : String(error) }));
        message = "Internal error. Try again later.";
      }
      return { content: [{ type: "text", text: message }], isError: true };
    }
  };
}
