/**
 * Crash reports from the client, logged and nothing else (#317).
 *
 * One structured line per report, and no row anywhere: the only thing written
 * is the rate limit's counter (`admitClientError`), which holds an address
 * and a number and expires on its own. The report is scrubbed again here
 * whatever the client did (`scrubReport`), and only its checked fields are
 * logged, so nothing the sender adds can reach the log.
 */

import { scrubReport } from "@kad/shared";
import { admitClientError } from "./code-guard.ts";
import type { HandlerDeps } from "./deps.ts";

export type ClientErrorOutcome = "logged" | "refused" | "malformed";

export async function reportClientError(
  body: unknown,
  client: string,
  deps: Pick<HandlerDeps, "repo" | "now">,
  log: (line: string) => void = (line) => console.log(line),
): Promise<ClientErrorOutcome> {
  const report = scrubReport(body);
  if (!report) return "malformed";
  if (!(await admitClientError(client, deps))) return "refused";
  log(JSON.stringify({ event: "client_error", ...report }));
  return "logged";
}
