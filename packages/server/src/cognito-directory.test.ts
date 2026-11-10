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

describe("CognitoDirectory.openAccount", () => {
  const directoryWith = (call: ReturnType<typeof vi.fn>) =>
    new CognitoDirectory({ userPoolId: "us-east-1_pool", region: "us-east-1", client: { call } as never });

  it("makes the account with no invitation sent, then gives it a password nobody chose", async () => {
    const call = vi.fn(async (_action: string, _body: Record<string, unknown>) => ({}));
    await directoryWith(call).openAccount("ada@example.com");

    expect(call.mock.calls.map(([action]) => action)).toEqual(["AdminCreateUser", "AdminSetUserPassword"]);
    expect(call.mock.calls[0]?.[1]).toEqual({
      UserPoolId: "us-east-1_pool",
      Username: "ada@example.com",
      // The only message a family gets is the code they asked for.
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: "ada@example.com" },
        { Name: "email_verified", Value: "true" },
      ],
    });
    const set = call.mock.calls[1]?.[1] as { UserPoolId: string; Username: string; Password: string; Permanent: boolean };
    expect(set).toMatchObject({ UserPoolId: "us-east-1_pool", Username: "ada@example.com", Permanent: true });
    expect(set.Password.length).toBeGreaterThan(40);
  });

  it("never gives two accounts the same password, nor one account the same password twice", async () => {
    const call = vi.fn(async (_action: string, _body: Record<string, unknown>) => ({}));
    const directory = directoryWith(call);
    await directory.openAccount("ada@example.com");
    await directory.openAccount("ada@example.com");
    await directory.openAccount("ben@example.com");
    const passwords = call.mock.calls.filter(([action]) => action === "AdminSetUserPassword").map(([, body]) => body["Password"]);
    expect(new Set(passwords).size).toBe(3);
  });

  it("treats an address that already has a sign-in as the ordinary case, and still replaces its password", async () => {
    // Every returning grown-up; and an account left half-made by a call that
    // died between the two steps is finished here instead of stuck for good.
    const call = vi.fn(async (action: string, _body: Record<string, unknown>) => {
      if (action === "AdminCreateUser") throw new AwsJsonError("UsernameExistsException", 400, "An account with the given email already exists.");
      return {};
    });
    await expect(directoryWith(call).openAccount("ada@example.com")).resolves.toBeUndefined();
    expect(call.mock.calls.map(([action]) => action)).toEqual(["AdminCreateUser", "AdminSetUserPassword"]);
  });

  it("passes any other failure up, and does not go on to the password", async () => {
    const call = vi.fn(async (_action: string, _body: Record<string, unknown>) => {
      throw new AwsJsonError("TooManyRequestsException", 400, "slow down");
    });
    await expect(directoryWith(call).openAccount("ada@example.com")).rejects.toMatchObject({ type: "TooManyRequestsException" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("fails when the password could not be set, so the caller asks for no code", async () => {
    const call = vi.fn(async (action: string, _body: Record<string, unknown>) => {
      if (action === "AdminSetUserPassword") throw new AwsJsonError("InternalErrorException", 500, "oops");
      return {};
    });
    await expect(directoryWith(call).openAccount("ada@example.com")).rejects.toMatchObject({ type: "InternalErrorException" });
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
