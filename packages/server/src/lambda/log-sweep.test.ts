/**
 * The log sweeper (#524): streams whose newest event is past 30 days go,
 * everything newer stays, and nothing ever touches a group's settings.
 */

import { describe, expect, it, vi } from "vitest";
import { AwsJsonError } from "../aws-json.ts";
import { cloudWatchLogs, LOG_MAX_AGE_MS, sweepLogs, type LogsApi, type LogStream } from "./log-sweep.ts";

const NOW = Date.parse("2026-11-01T04:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const PREFIX = "/aws/lambda/kad-prod-";

/** A fake account: groups by name, each with pages of streams. */
function account(groups: Record<string, LogStream[][]>): LogsApi & { deletedFrom: [string, string][] } {
  const deletedFrom: [string, string][] = [];
  return {
    deletedFrom,
    async describeLogGroups(prefix) {
      return { groups: Object.keys(groups).filter((g) => g.startsWith(prefix)) };
    },
    async describeLogStreams(group, nextToken) {
      const pages = groups[group] ?? [];
      const index = nextToken ? Number(nextToken) : 0;
      return { streams: pages[index] ?? [], ...(index + 1 < pages.length ? { nextToken: String(index + 1) } : {}) };
    },
    async deleteLogStream(group, stream) {
      deletedFrom.push([group, stream]);
    },
  };
}

function deps(logs: LogsApi, remainingMs = () => Number.POSITIVE_INFINITY) {
  return { logs, prefix: PREFIX, now: () => NOW, remainingMs };
}

describe("sweepLogs", () => {
  it("deletes only streams whose newest event is older than 30 days, on every page of every group", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logs = account({
      [`${PREFIX}ApiFunction-abc`]: [
        [
          { logStreamName: "old", lastEventTimestamp: NOW - LOG_MAX_AGE_MS - 1 },
          { logStreamName: "fresh", lastEventTimestamp: NOW - 2 * DAY },
        ],
        [{ logStreamName: "old-page-two", lastEventTimestamp: NOW - 45 * DAY }],
      ],
      [`${PREFIX}SweepFunction-def`]: [
        [
          { logStreamName: "empty-old", creationTime: NOW - 40 * DAY },
          { logStreamName: "edge", lastEventTimestamp: NOW - LOG_MAX_AGE_MS },
          { logStreamName: "no-dates" },
        ],
      ],
      "/aws/lambda/someone-else": [[{ logStreamName: "not-ours", lastEventTimestamp: 0 }]],
    });

    const result = await sweepLogs(deps(logs));
    expect(logs.deletedFrom).toEqual([
      [`${PREFIX}ApiFunction-abc`, "old"],
      [`${PREFIX}ApiFunction-abc`, "old-page-two"],
      [`${PREFIX}SweepFunction-def`, "empty-old"],
    ]);
    expect(result).toEqual({ groups: 2, deleted: 3, failed: 0, unfinished: false });
    log.mockRestore();
  });

  it("counts a failed delete and carries on", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logs = account({
      [`${PREFIX}ApiFunction-abc`]: [
        [
          { logStreamName: "a", lastEventTimestamp: 0 },
          { logStreamName: "b", lastEventTimestamp: 0 },
        ],
      ],
    });
    const deleteLogStream = logs.deleteLogStream.bind(logs);
    logs.deleteLogStream = async (group, stream) => {
      if (stream === "a") throw new Error("throttled");
      await deleteLogStream(group, stream);
    };
    expect(await sweepLogs(deps(logs))).toMatchObject({ deleted: 1, failed: 1 });
    log.mockRestore();
    error.mockRestore();
  });

  it("stops before the function's time is up, and says so", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const logs = account({ [`${PREFIX}ApiFunction-abc`]: [[{ logStreamName: "old", lastEventTimestamp: 0 }]] });
    const result = await sweepLogs(deps(logs, () => 10_000));
    expect(result).toMatchObject({ deleted: 0, unfinished: true });
    expect(logs.deletedFrom).toEqual([]);
    log.mockRestore();
  });
});

describe("cloudWatchLogs", () => {
  it("speaks CloudWatch Logs' operations, following nextToken", async () => {
    const call = vi.fn(async (operation: string, input: object): Promise<unknown> => {
      if (operation === "DescribeLogGroups") {
        return "nextToken" in input ? { logGroups: [{ logGroupName: "g2" }] } : { logGroups: [{ logGroupName: "g1" }], nextToken: "t" };
      }
      if (operation === "DescribeLogStreams") return { logStreams: [{ logStreamName: "s", lastEventTimestamp: 1 }] };
      return {};
    });
    const api = cloudWatchLogs("us-east-1", { call: call as never });
    expect(await api.describeLogGroups(PREFIX)).toEqual({ groups: ["g1"], nextToken: "t" });
    expect(await api.describeLogGroups(PREFIX, "t")).toEqual({ groups: ["g2"] });
    expect(await api.describeLogStreams("g1")).toEqual({ streams: [{ logStreamName: "s", lastEventTimestamp: 1 }] });
    await api.deleteLogStream("g1", "s");
    expect(call).toHaveBeenCalledWith("DescribeLogGroups", { logGroupNamePrefix: PREFIX });
    expect(call).toHaveBeenCalledWith("DeleteLogStream", { logGroupName: "g1", logStreamName: "s" });
    // Nothing that changes a group: no retention policy, no group deletes.
    const operations = call.mock.calls.map(([operation]) => operation);
    expect(operations).not.toContain("PutRetentionPolicy");
    expect(operations).not.toContain("DeleteLogGroup");
  });

  it("passes a service error through", async () => {
    const api = cloudWatchLogs("us-east-1", {
      call: (async () => {
        throw new AwsJsonError("ThrottlingException", 400, "slow down");
      }) as never,
    });
    await expect(api.deleteLogStream("g", "s")).rejects.toMatchObject({ type: "ThrottlingException" });
  });
});
