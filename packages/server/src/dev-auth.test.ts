import { describe, expect, it } from "vitest";
import { devAccountSub, verifyDevToken } from "./dev-auth.ts";

const token = (claims: unknown) =>
  `dev.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;

describe("verifyDevToken", () => {
  it("derives a stable account from the email, ignoring case and spacing", () => {
    const a = verifyDevToken(token({ email: "Ada@Example.com " }));
    const b = verifyDevToken(token({ email: "ada@example.com" }));
    expect(a).toEqual({ cognitoSub: devAccountSub("ada@example.com"), email: "ada@example.com" });
    expect(a).toEqual(b);
  });

  it("gives different addresses different accounts", () => {
    expect(devAccountSub("a@x.com")).not.toBe(devAccountSub("b@x.com"));
  });

  it("rejects anything that is not a dev token", () => {
    expect(verifyDevToken("")).toBeNull();
    expect(verifyDevToken("eyJhbGciOi.real.jwt")).toBeNull();
    expect(verifyDevToken("dev.not-base64-json")).toBeNull();
    expect(verifyDevToken(token({ email: "no-at-sign" }))).toBeNull();
    expect(verifyDevToken(token({}))).toBeNull();
  });
});
