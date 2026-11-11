/**
 * The MCP endpoint (docs/mcp-server.md): `/api/mcp` on the site's domain.
 *
 * As content-tracking's functions/mcp/index.mjs: the 2026-07-28 Streamable HTTP
 * transport served statelessly by `@modelcontextprotocol/server`, one fresh
 * server per request bound to the caller's key, plain JSON answers, and the
 * SDK's stateless fallback for 2025-era clients. Browser origins are refused
 * (agents call from servers and send no Origin).
 *
 * The one structural difference: there, an API Gateway authorizer checks the key
 * before the function runs. This stack's HTTP API authorizer caches its answers
 * for five minutes, which would let a revoked key work for five more, so the
 * key is checked here, on every request, against its row.
 */

import { createMcpHandler, originValidationResponse } from "@modelcontextprotocol/server";
import { bearerKey, verifyKey, type KeyStore } from "./keys.ts";
import { buildServer, type ServerDeps } from "./server.ts";

const MAX_BODY_BYTES = 1024 * 1024;

export interface McpEndpointDeps extends ServerDeps {
  keys: KeyStore;
  /** Hostnames a browser may call from; empty refuses every browser origin. */
  allowedOriginHosts?: string[];
}

export type McpEndpoint = (request: Request) => Promise<Response>;

export function mcpEndpoint(deps: McpEndpointDeps): McpEndpoint {
  const mcp = createMcpHandler(
    ({ authInfo }) => {
      const key = authInfo?.extra?.key;
      // Fail closed: nothing reaches the factory without a verified key.
      if (!key) throw new Error("MCP server built without a verified key");
      return buildServer(key as Parameters<typeof buildServer>[0], deps);
    },
    {
      maxRequestBodySize: MAX_BODY_BYTES,
      onerror: (error: Error) => console.warn(JSON.stringify({ msg: "MCP request rejected", error: error.message })),
    },
  );

  return async (request) => {
    const presented = bearerKey(request.headers.get("authorization"));
    const key = presented ? await verifyKey(deps.keys, presented) : null;
    if (!key) {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "A live MCP key is required (Authorization: Bearer kadmcp_…)." } }), {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
      });
    }
    const rejected = originValidationResponse(request, deps.allowedOriginHosts ?? []);
    if (rejected) return rejected;
    return mcp.fetch(request, {
      authInfo: { token: "", clientId: key.id, scopes: key.scopes, extra: { key } },
    });
  };
}
