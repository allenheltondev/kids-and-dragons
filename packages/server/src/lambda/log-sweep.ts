/**
 * The log sweeper (#524): once a month, every log stream of this stack's
 * functions whose last event is more than 30 days old is deleted.
 *
 * Why a sweeper and not `RetentionInDays`: the stack declares no log groups
 * (`infra/template.yaml`), on purpose, because Lambda makes them on the first
 * invocation and declaring them is what has caused deploy trouble. This
 * leaves every group's retention setting alone, so whatever else manages it
 * still can; it only removes old data.
 *
 * CloudWatch Logs can delete a whole stream, never single events. A Lambda
 * stream is one execution environment's output, so it covers hours, not
 * weeks; a stream is deleted once its newest event is past 30 days. Run
 * monthly, the oldest log line kept is therefore at most about two months old,
 * which is what the privacy page says.
 *
 * Bounded by time rather than count: it stops with a margin before the
 * function's timeout, and next month's run carries on.
 */

import type { Context } from "aws-lambda";
import { AwsJsonClient } from "../aws-json.ts";
import { requiredEnv } from "./runtime.ts";

/** A stream whose newest event is older than this is deleted. */
export const LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Stop this long before the function's timeout, so a run never dies mid-call. */
const SAFETY_MARGIN_MS = 30_000;

export interface LogStream {
  logStreamName: string;
  /** Epoch millis. Absent for a stream with no events. */
  lastEventTimestamp?: number;
  creationTime?: number;
}

/** The three CloudWatch Logs calls the sweep makes, as a seam for tests. */
export interface LogsApi {
  describeLogGroups(prefix: string, nextToken?: string): Promise<{ groups: string[]; nextToken?: string }>;
  describeLogStreams(group: string, nextToken?: string): Promise<{ streams: LogStream[]; nextToken?: string }>;
  deleteLogStream(group: string, stream: string): Promise<void>;
}

export interface LogSweepResult {
  groups: number;
  deleted: number;
  failed: number;
  /** True when it stopped for time with streams left to look at. */
  unfinished: boolean;
}

export interface LogSweepDeps {
  logs: LogsApi;
  /** Log group name prefix: this stack's functions, `/aws/lambda/<stack>-`. */
  prefix: string;
  now: () => number;
  /** Milliseconds left before the function must stop. */
  remainingMs: () => number;
}

export async function handler(_event: unknown, context?: Context): Promise<LogSweepResult> {
  const logs = cloudWatchLogs(requiredEnv("AWS_REGION"));
  return sweepLogs({
    logs,
    prefix: requiredEnv("LOG_GROUP_PREFIX"),
    now: Date.now,
    remainingMs: () => context?.getRemainingTimeInMillis() ?? Number.POSITIVE_INFINITY,
  });
}

/** One sweep over every group under `prefix`; the handler is this on CloudWatch Logs. */
export async function sweepLogs(deps: LogSweepDeps): Promise<LogSweepResult> {
  const cutoff = deps.now() - LOG_MAX_AGE_MS;
  const result: LogSweepResult = { groups: 0, deleted: 0, failed: 0, unfinished: false };
  const outOfTime = () => deps.remainingMs() < SAFETY_MARGIN_MS;

  const groups: string[] = [];
  let groupToken: string | undefined;
  do {
    const page = await deps.logs.describeLogGroups(deps.prefix, groupToken);
    groups.push(...page.groups);
    groupToken = page.nextToken;
  } while (groupToken);

  sweeping: for (const group of groups) {
    result.groups++;
    let streamToken: string | undefined;
    do {
      if (outOfTime()) {
        result.unfinished = true;
        break sweeping;
      }
      const page = await deps.logs.describeLogStreams(group, streamToken);
      for (const stream of page.streams) {
        // A stream with no events is judged by when it was made.
        const newest = stream.lastEventTimestamp ?? stream.creationTime;
        if (newest === undefined || newest >= cutoff) continue;
        if (outOfTime()) {
          result.unfinished = true;
          break sweeping;
        }
        try {
          await deps.logs.deleteLogStream(group, stream.logStreamName);
          result.deleted++;
        } catch (err) {
          result.failed++;
          console.error(`[log-sweep] could not delete ${group} ${stream.logStreamName}:`, err);
        }
      }
      streamToken = page.nextToken;
    } while (streamToken);
  }

  console.log(
    `[log-sweep] ${String(result.groups)} groups, deleted ${String(result.deleted)} streams older than 30 days, ` +
      `failed ${String(result.failed)}${result.unfinished ? "; stopped for time, next run continues" : ""}`,
  );
  return result;
}

/** `LogsApi` over CloudWatch Logs' JSON API. */
export function cloudWatchLogs(region: string, client?: Pick<AwsJsonClient, "call">): LogsApi {
  const api = client ?? new AwsJsonClient({ service: "logs", region, targetPrefix: "Logs_20140328" });
  return {
    async describeLogGroups(prefix, nextToken) {
      const out = await api.call<{ logGroups?: { logGroupName?: string }[]; nextToken?: string }>("DescribeLogGroups", {
        logGroupNamePrefix: prefix,
        ...(nextToken ? { nextToken } : {}),
      });
      return {
        groups: (out.logGroups ?? []).flatMap((g) => (g.logGroupName ? [g.logGroupName] : [])),
        ...(out.nextToken ? { nextToken: out.nextToken } : {}),
      };
    },
    async describeLogStreams(group, nextToken) {
      const out = await api.call<{ logStreams?: LogStream[]; nextToken?: string }>("DescribeLogStreams", {
        logGroupName: group,
        ...(nextToken ? { nextToken } : {}),
      });
      return { streams: out.logStreams ?? [], ...(out.nextToken ? { nextToken: out.nextToken } : {}) };
    },
    async deleteLogStream(group, stream) {
      await api.call("DeleteLogStream", { logGroupName: group, logStreamName: stream });
    },
  };
}
