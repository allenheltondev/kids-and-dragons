/**
 * The grown-ups' sign-in store, and the two things the server does to it.
 *
 * The sweep (#524) deletes a sign-in, and nothing else: a grown-up's Cognito
 * user holds their email, so once the last household they own is deleted for
 * being idle, their sign-in goes too (`handlers/retention.ts`, `retireIfLast`).
 *
 * The API opens one (`POST /api/auth/start`): it makes sure an account exists
 * for an address before the emailed code is asked for. The browser used to do
 * that itself with Cognito's public `SignUp`, which takes a password, and the
 * pool could not tell a client that throws its password away from a caller
 * who keeps theirs. Made here, an account never has a password anyone chose.
 */

import { randomBytes } from "node:crypto";
import { AwsJsonClient, AwsJsonError } from "./aws-json.ts";
import type { AccountDirectory } from "./handlers/deps.ts";

export interface CognitoDirectoryOptions {
  userPoolId: string;
  region: string;
  /** Injected by tests. */
  client?: Pick<AwsJsonClient, "call">;
}

export class CognitoDirectory implements AccountDirectory {
  private readonly userPoolId: string;
  private readonly client: Pick<AwsJsonClient, "call">;

  constructor(options: CognitoDirectoryOptions) {
    this.userPoolId = options.userPoolId;
    this.client =
      options.client ??
      new AwsJsonClient({
        service: "cognito-idp",
        region: options.region,
        targetPrefix: "AWSCognitoIdentityProviderService",
      });
  }

  /**
   * Makes sure `email` has a sign-in, and that nobody holds a password to it.
   *
   * `AdminCreateUser` with no invitation sent: the only message a family gets
   * is the code they asked for. An address that already has a sign-in is the
   * ordinary case, not an error.
   *
   * Then a password nobody knows, every time and not only for a new account.
   * A created account is not usable until it has a permanent password, so a
   * call that died between the two steps would otherwise leave an address
   * that can never sign in; and an older account made through the public
   * sign-up is brought under the same rule the first time its owner comes
   * back. It signs nobody out and touches neither the emailed code nor a
   * passkey, which are the only ways in.
   */
  async openAccount(email: string): Promise<void> {
    try {
      await this.client.call("AdminCreateUser", {
        UserPoolId: this.userPoolId,
        Username: email,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: email },
          // The emailed code is what proves the inbox; Cognito will not send
          // one to an address it holds as unverified.
          { Name: "email_verified", Value: "true" },
        ],
      });
    } catch (err) {
      if (!(err instanceof AwsJsonError && err.type === "UsernameExistsException")) throw err;
    }
    await this.client.call("AdminSetUserPassword", {
      UserPoolId: this.userPoolId,
      Username: email,
      // 32 random bytes plus one character of each class a policy can ask
      // for. Sent once, kept nowhere.
      Password: `Aa1!${randomBytes(32).toString("base64url")}`,
      Permanent: true,
    });
  }

  /**
   * `AdminDeleteUser` by the user's `sub`, which the pool accepts as the
   * username (its usernames are emails, `infra/template.yaml`). A user
   * already gone is done, not an error.
   */
  async deleteAccount(cognitoSub: string): Promise<void> {
    try {
      await this.client.call("AdminDeleteUser", { UserPoolId: this.userPoolId, Username: cognitoSub });
    } catch (err) {
      if (err instanceof AwsJsonError && err.type === "UserNotFoundException") return;
      throw err;
    }
  }
}
