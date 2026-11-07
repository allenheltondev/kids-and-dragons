/**
 * The sweep's view of the sign-in store (#524): one operation, by `sub`, and
 * a user already gone is not an error.
 */

import { describe, expect, it, vi } from "vitest";
import { AwsJsonClient, AwsJsonError } from "./aws-json.ts";
import { CognitoDirectory } from "./cognito-directory.ts";

describe("CognitoDirectory", () => {
  it("deletes a sign-in by its sub, in this pool", async () => {
    const call = vi.fn(async () => ({}));
    const directory = new CognitoDirectory({ userPoolId: "us-east-1_pool", region: "us-east-1", client: { call } as never });
    await directory.deleteAccount("sub-123");
    expect(call).toHaveBeenCalledWith("AdminDeleteUser", { UserPoolId: "us-east-1_pool", Username: "sub-123" });
  });

  it("treats a sign-in already gone as done", async () => {
    const call = vi.fn(async () => {
      throw new AwsJsonError("UserNotFoundException", 400, "User does not exist.");
    });
    const directory = new CognitoDirectory({ userPoolId: "p", region: "us-east-1", client: { call } as never });
    await expect(directory.deleteAccount("sub-gone")).resolves.toBeUndefined();
  });

  it("passes any other failure up, for the sweep to log", async () => {
    const call = vi.fn(async () => {
      throw new AwsJsonError("TooManyRequestsException", 400, "slow down");
    });
    const directory = new CognitoDirectory({ userPoolId: "p", region: "us-east-1", client: { call } as never });
    await expect(directory.deleteAccount("sub-1")).rejects.toMatchObject({ type: "TooManyRequestsException" });
  });
});

describe("AwsJsonClient", () => {
  const credentials = async () => ({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" });

  it("signs a JSON 1.1 POST with the operation in x-amz-target", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response("{}", { status: 200 }));
    const client = new AwsJsonClient({
      service: "cognito-idp",
      region: "us-east-1",
      targetPrefix: "AWSCognitoIdentityProviderService",
      credentials,
      fetch: fetch as never,
    });
    await client.call("AdminDeleteUser", { UserPoolId: "p", Username: "u" });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://cognito-idp.us-east-1.amazonaws.com/");
    const headers = init!.headers as Record<string, string>;
    expect(headers["x-amz-target"]).toBe("AWSCognitoIdentityProviderService.AdminDeleteUser");
    expect(headers["content-type"]).toBe("application/x-amz-json-1.1");
    expect(headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/cognito-idp\/aws4_request/);
    expect(JSON.parse(String(init!.body))).toEqual({ UserPoolId: "p", Username: "u" });
  });

  it("turns an error answer into an AwsJsonError with the short type", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ __type: "com.amazonaws.cognito#UserNotFoundException", message: "User does not exist." }), {
          status: 400,
        }),
    );
    const client = new AwsJsonClient({ service: "cognito-idp", region: "us-east-1", targetPrefix: "X", credentials, fetch: fetch as never });
    await expect(client.call("AdminDeleteUser", {})).rejects.toMatchObject({ type: "UserNotFoundException", status: 400 });
  });
});
