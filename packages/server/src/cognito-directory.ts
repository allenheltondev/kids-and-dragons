/**
 * The grown-ups' sign-in store, as the sweep sees it (#524): it can delete a
 * sign-in, and nothing else. A grown-up's Cognito user holds their email, so
 * once the last household they own is deleted for being idle, their sign-in
 * goes too (`handlers/retention.ts`, `retireIfEmpty`).
 */

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
