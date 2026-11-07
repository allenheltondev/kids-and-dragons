/**
 * One signed call to an AWS service that speaks the JSON 1.1 protocol
 * (Cognito user pools, CloudWatch Logs), for the retention work in #524.
 *
 * Why not the SDK clients: each would be a new dependency in the Lambda
 * bundle for one or three operations, and the server already signs requests
 * itself for AppSync (`channel/appsync-events-channel.ts`) with the same
 * SigV4 signer and credential chain. The protocol is a POST of a JSON body
 * with the operation in `x-amz-target`.
 */

import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { Hash } from "@smithy/hash-node";
import { HttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import type { AwsCredentialIdentityProvider } from "@smithy/types";

export interface AwsJsonClientOptions {
  /** The signing name and endpoint prefix, e.g. `cognito-idp` or `logs`. */
  service: string;
  region: string;
  /** The `x-amz-target` prefix, e.g. `AWSCognitoIdentityProviderService`. */
  targetPrefix: string;
  /** Defaults to the Lambda execution role. */
  credentials?: AwsCredentialIdentityProvider;
  /** Injected by tests. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** A call past this is not coming back; the caller logs it and moves on. */
export const AWS_CALL_TIMEOUT_MS = 10_000;

/** An error the service answered with: its short `__type` (e.g. `UserNotFoundException`) and HTTP status. */
export class AwsJsonError extends Error {
  constructor(
    readonly type: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AwsJsonError";
  }
}

export class AwsJsonClient {
  private readonly signer: SignatureV4;
  private readonly hostname: string;
  private readonly targetPrefix: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: AwsJsonClientOptions) {
    this.hostname = `${options.service}.${options.region}.amazonaws.com`;
    this.targetPrefix = options.targetPrefix;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.signer = new SignatureV4({
      service: options.service,
      region: options.region,
      credentials: options.credentials ?? defaultProvider(),
      sha256: Hash.bind(null, "sha256"),
    });
  }

  /** `operation` with `input`; the parsed response, or an `AwsJsonError`. */
  async call<T>(operation: string, input: object): Promise<T> {
    const body = JSON.stringify(input);
    const request = new HttpRequest({
      method: "POST",
      protocol: "https:",
      hostname: this.hostname,
      path: "/",
      headers: {
        // Signed with the rest, as AppSync's: a header the signature does not
        // cover the way the service computes it 403s every call.
        host: this.hostname,
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `${this.targetPrefix}.${operation}`,
      },
      body,
    });
    const signed = await this.signer.sign(request);
    const response = await this.fetchImpl(`https://${this.hostname}/`, {
      method: "POST",
      headers: signed.headers,
      body,
      signal: AbortSignal.timeout(AWS_CALL_TIMEOUT_MS),
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      // `__type` is sometimes namespaced (`com.amazonaws...#UserNotFoundException`).
      const type = String(parsed["__type"] ?? "UnknownError").split("#").pop() ?? "UnknownError";
      const message = String(parsed["message"] ?? parsed["Message"] ?? text.slice(0, 300));
      throw new AwsJsonError(type, response.status, `${operation} failed: ${type}: ${message}`);
    }
    return parsed as T;
  }
}
