/**
 * The MCP Lambda (docs/mcp-server.md): `ANY /api/mcp` on the HTTP API, reached
 * through CloudFront's `/api/*` behavior. Converts the HTTP API's payload v2
 * event to a web Request and the Response back; everything else is in
 * ../mcp/handler.ts.
 *
 * Its role reaches the keys table and the asset store, and nothing that holds a
 * family's data (infra/template.yaml, McpFunction).
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DynamoKeyStore } from "../mcp/dynamo-keys.ts";
import { mcpEndpoint, type McpEndpoint } from "../mcp/handler.ts";
import { S3UploadSigner } from "../mcp/uploads.ts";

let endpoint: McpEndpoint | null = null;

function live(): McpEndpoint {
  endpoint ??= mcpEndpoint({
    keys: new DynamoKeyStore(required("MCP_KEYS_TABLE")),
    signer: new S3UploadSigner(required("ASSET_STORE_BUCKET")),
    allowedOriginHosts: (process.env.MCP_ALLOWED_ORIGIN_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean),
  });
  return endpoint;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return toResult(await live()(toRequest(event)));
}

/** HTTP API payload v2 → web Request. Header names arrive lower-cased, repeated values comma-joined. */
export function toRequest(event: APIGatewayProxyEventV2): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers.set(name, value);
  }
  if (event.cookies?.length) headers.set("cookie", event.cookies.join("; "));
  // The request's own Host, so the SDK sees the URL the caller used. Nothing is fetched from it.
  const inboundHost = headers.get("host") ?? event.requestContext?.domainName ?? "localhost";
  const query = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const method = event.requestContext?.http?.method ?? "POST";
  const hasBody = method !== "GET" && method !== "HEAD" && event.body;
  const body = hasBody ? (event.isBase64Encoded ? Buffer.from(event.body!, "base64") : event.body) : undefined;
  const inboundUrl = `https://${inboundHost}`;
  return new Request(`${inboundUrl}${event.rawPath ?? "/api/mcp"}${query}`, { method, headers, body });
}

export async function toResult(response: Response): Promise<APIGatewayProxyStructuredResultV2> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { statusCode: response.status, headers, body: await response.text() };
}
