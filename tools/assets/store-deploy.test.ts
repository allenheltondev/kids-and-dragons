/**
 * The asset store is created and kept up to date by the production deploy
 * (`scripts/deploy-asset-store.sh`), never by hand, and its address is declared
 * in `assets.config.json` rather than copied back from a stack output.
 *
 * Both are easy to lose in an edit. A store that deploys before the site can
 * keep a fix from the families; one that follows a rollback goes backwards; a
 * parameter the script forgets keeps last month's value; and a `storeUrl` the
 * stack does not serve is a repo every clone pulls nothing from. Read as text
 * where wiring is the point, and run for real, against a stub `aws`, where the
 * script decides something.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...parts: string[]) => fs.readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
const SCRIPT = read("scripts", "deploy-asset-store.sh");
const TEMPLATE = read("infra", "asset-store.yaml");
const PROD = read(".github", "workflows", "prod-deploy.yml");
const STAGING = read(".github", "workflows", "deploy.yml");
const config = JSON.parse(read("assets.config.json")) as { storeUrl: string | null };

/** Commands only: the headers explain in words that would otherwise match. */
const commands = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

describe("the store's address", () => {
  it("is declared in assets.config.json, as an https host and nothing after it", () => {
    expect(config.storeUrl).toMatch(/^https:\/\/[a-z0-9.-]+$/);
  });

  it("is what the stack is built to serve: the template takes the host and answers with it", () => {
    expect(TEMPLATE).toMatch(/^ {2}StoreDomainName:\n {4}Type: String/m);
    expect(TEMPLATE).toMatch(/^ {2}HostedZoneId:\n {4}Type: String/m);
    expect(TEMPLATE).toContain("Aliases: !If [CustomDomain, [!Ref StoreDomainName], !Ref AWS::NoValue]");
    const output = TEMPLATE.slice(TEMPLATE.indexOf("\n  StoreUrl:"));
    expect(output.slice(0, output.indexOf("\n  DistributionId:"))).toContain('!Sub "https://${StoreDomainName}"');
  });

  it("is checked against the stack after every deploy, and asked to answer", () => {
    const code = commands(SCRIPT);
    const deploy = code.indexOf("aws cloudformation deploy");
    expect(deploy).toBeGreaterThan(-1);
    expect(code.indexOf('if [ "$SERVES" != "$STORE_URL" ]')).toBeGreaterThan(deploy);
    expect(code.indexOf('curl -sS -o /dev/null -m 20 -w \'%{http_code}\' "$STORE_URL/"')).toBeGreaterThan(deploy);
    // Only the root's own answer counts as up; a 5xx or a 404 is an answer and not a store.
    expect(code.slice(deploy)).toMatch(/case "\$code" in\s+200\|403\)/);
  });
});

describe("the store's template", () => {
  it("keeps the bucket when the stack goes, and takes it back when a first create rolls back", () => {
    const bucket = TEMPLATE.slice(TEMPLATE.indexOf("\n  StoreBucket:"), TEMPLATE.indexOf("\n  StoreBucketPolicy:"));
    // Plain Retain would strand an empty bucket no stack owns, and the next create would fail on its name.
    expect(bucket).toContain("DeletionPolicy: RetainExceptOnCreate");
    expect(bucket).toContain("UpdateReplacePolicy: Retain");
  });

  it("is given every parameter the deploy decides, by the names the template uses", () => {
    const passed = [...commands(SCRIPT).matchAll(/^ {2}"([A-Za-z]+)=/gm)].map((m) => m[1]);
    expect(passed.sort()).toEqual(["AlarmTopicArn", "HostedZoneId", "MonthlyBudgetUsd", "StoreDomainName"]);
    const parameters = TEMPLATE.slice(TEMPLATE.indexOf("\nParameters:"), TEMPLATE.indexOf("\nConditions:"));
    for (const name of passed) expect(parameters, name).toMatch(new RegExp(`^ {2}${name}:$`, "m"));
  });
});

describe("the production deploy and the store", () => {
  const steps = PROD.slice(PROD.indexOf("\n    steps:"));
  const store = steps.indexOf("run: ./scripts/deploy-asset-store.sh");

  it("deploys the store, after the site is live and its summary is written", () => {
    expect(store).toBeGreaterThan(-1);
    expect(store).toBeGreaterThan(steps.indexOf("run: ./scripts/deploy.sh prod"));
    expect(store).toBeGreaterThan(steps.indexOf("- name: Read stack outputs"));
    expect(store).toBeGreaterThan(steps.indexOf("- name: Write deployment summary"));
  });

  it("gives it the hosted zone, and never follows a rollback to an older template", () => {
    const step = steps.slice(steps.lastIndexOf("- name:", store));
    expect(step).toContain("if: github.event_name == 'workflow_run' || inputs.ref == ''");
    expect(step).toContain("APP_HOSTED_ZONE_ID: ${{ vars.HOSTED_ZONE_ID }}");
  });

  it("is the only workflow that does: staging lives in another account and reads production's store", () => {
    expect(STAGING).not.toContain("deploy-asset-store");
  });

  it("uses plain node, because a ship-mode deploy has no node_modules", () => {
    const code = commands(SCRIPT);
    expect(code).not.toMatch(/\bnpm\b|\bnpx\b|\btsx\b/);
    expect(code).not.toContain("tools/");
  });
});

// ---------------------------------------------------------------------------
// Run for real, with `aws` and `curl` replaced by stubs and credentials that
// open nothing. The stubs are shell functions (BASH_ENV) as well as files first
// on PATH: a function wins whatever the shell does to PATH on the way in, and
// Git Bash puts its own curl ahead of anything inherited. Not on Windows by
// default, where `bash` may be the WSL launcher; KAD_TEST_BASH names a real one.
// ---------------------------------------------------------------------------

const BASH = process.env.KAD_TEST_BASH ?? "bash";
const runnable = process.platform !== "win32" || process.env.KAD_TEST_BASH !== undefined;

const AWS_STUB = `#!/usr/bin/env bash
echo "$*" >> "$STUB_DIR/calls.log"
gone() { echo "An error occurred (ValidationError) when calling the DescribeStacks operation: Stack with id $1 does not exist" >&2; exit 254; }
case "$1 $2" in
  "cloudformation describe-stacks")
    stack=""; query=""
    while [ $# -gt 0 ]; do
      case "$1" in --stack-name) stack="$2"; shift ;; --query) query="$2"; shift ;; esac
      shift
    done
    case "$stack" in
      kad-asset-store)
        case "$query" in
          *StackStatus*)
            if [ -f "$STUB_DIR/deployed" ]; then echo CREATE_COMPLETE
            elif [ -f "$STUB_DIR/deleted" ] || [ -z "\${STUB_STATUS:-}" ]; then gone "$stack"
            else echo "$STUB_STATUS"; fi ;;
          *StoreUrl*) echo "\${STUB_SERVES-https://assets.example.org}" ;;
        esac ;;
      kad-prod)
        if [ -n "\${STUB_PROD_ERROR:-}" ]; then echo "$STUB_PROD_ERROR" >&2; exit 254; fi
        if [ -n "\${STUB_PROD_GONE:-}" ]; then gone "$stack"; fi
        case "$query" in
          *StackStatus*) echo UPDATE_COMPLETE ;;
          # What the CLI prints, as text, for an output that is not there.
          *AlarmTopicArn*) echo "\${STUB_TOPIC-arn:aws:sns:us-east-1:000000000000:kad-prod-alarms}" ;;
        esac ;;
    esac ;;
  "cloudformation delete-stack") touch "$STUB_DIR/deleted" ;;
  "cloudformation wait") ;;
  "cloudformation deploy")
    if [ -n "\${STUB_DEPLOY_FAILS:-}" ]; then exit 255; fi
    touch "$STUB_DIR/deployed" ;;
  "cloudformation describe-stack-events") echo "StoreBudget CREATE_FAILED not authorized" ;;
  *) echo "unexpected aws call: $*" >&2; exit 97 ;;
esac
`;

const CURL_STUB = `#!/usr/bin/env bash
echo "curl $*" >> "$STUB_DIR/calls.log"
if [ "\${STUB_HTTP:-403}" = "000" ]; then printf '000'; exit 6; fi
printf '%s' "\${STUB_HTTP:-403}"
`;

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Scene {
  env?: Record<string, string>;
  storeUrl?: string | null;
}

/** A scratch repo holding only the script and a config, so nothing here reads or touches the real one. */
function run(scene: Scene = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad-store-deploy-"));
  made.push(dir);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.mkdirSync(path.join(dir, "infra"));
  fs.writeFileSync(path.join(dir, "scripts", "deploy-asset-store.sh"), SCRIPT);
  fs.writeFileSync(path.join(dir, "infra", "asset-store.yaml"), "# never read: aws is a stub\n");
  fs.writeFileSync(
    path.join(dir, "assets.config.json"),
    JSON.stringify({
      storeUrl: scene.storeUrl === undefined ? "https://assets.example.org" : scene.storeUrl,
      stack: "kad-asset-store",
      region: "us-east-1",
    }),
  );
  for (const [name, body] of [["aws", AWS_STUB], ["curl", CURL_STUB]] as const) {
    fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  }
  const posix = (file: string) => file.split(path.sep).join("/");
  const stubs = path.join(dir, "stubs.sh");
  const functions = ["aws", "curl"].map((name) => `${name}() { bash "${posix(path.join(bin, name))}" "$@"; }`);
  fs.writeFileSync(stubs, [...functions, ""].join(String.fromCharCode(10)));

  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(path|aws_|ci$|kad_)/i.test(key)));
  const systemPath = Object.entries(process.env).find(([key]) => /^path$/i.test(key))?.[1] ?? "";
  const result = spawnSync(BASH, [path.join(dir, "scripts", "deploy-asset-store.sh")], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    env: {
      ...inherited,
      PATH: `${bin}${path.delimiter}${systemPath}`,
      BASH_ENV: posix(stubs),
      STUB_DIR: posix(dir),
      // Nothing here may reach AWS, stub or no stub.
      AWS_ACCESS_KEY_ID: "AKIADEADDEADDEADDEAD",
      AWS_SECRET_ACCESS_KEY: "dead",
      AWS_SESSION_TOKEN: "dead",
      AWS_EC2_METADATA_DISABLED: "true",
      AWS_CONFIG_FILE: path.join(dir, "no-config"),
      AWS_SHARED_CREDENTIALS_FILE: path.join(dir, "no-credentials"),
      CI: "true",
      APP_HOSTED_ZONE_ID: "Z0000000EXAMPLE",
      KAD_STORE_PROBE_WAIT: "0",
      ...scene.env,
    },
  });
  const log = path.join(dir, "calls.log");
  const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
  return { ...result, calls, deploy: calls.find((call) => call.startsWith("cloudformation deploy")) };
}

describe.skipIf(!runnable)("deploy-asset-store.sh, run", () => {
  it("creates the store at the declared address, with the zone, the alarm topic and the budget", () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.deploy).toContain("--stack-name kad-asset-store");
    expect(result.deploy).toContain("--no-fail-on-empty-changeset");
    expect(result.deploy).toContain("--capabilities CAPABILITY_NAMED_IAM");
    expect(result.deploy).toContain(
      "--parameter-overrides StoreDomainName=assets.example.org HostedZoneId=Z0000000EXAMPLE AlarmTopicArn=arn:aws:sns:us-east-1:000000000000:kad-prod-alarms MonthlyBudgetUsd=10",
    );
    expect(result.stdout).toContain("It answers as a healthy store does (HTTP 403)");
  });

  it("refuses from a laptop before it asks AWS anything", () => {
    const result = run({ env: { CI: "" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing to deploy the asset store from this checkout");
    expect(result.calls).toEqual([]);
    expect(run({ env: { CI: "", KAD_DEPLOY_ANYWAY: "1" } }).status).toBe(0);
  });

  it("refuses a config with no address, or one with no zone to put it in, before it asks AWS anything", () => {
    const unset = run({ storeUrl: null });
    expect(unset.status).toBe(1);
    expect(unset.stderr).toContain("assets.config.json has no storeUrl");
    expect(unset.calls).toEqual([]);

    const zoneless = run({ env: { APP_HOSTED_ZONE_ID: "" } });
    expect(zoneless.status).toBe(1);
    expect(zoneless.stderr).toContain("APP_HOSTED_ZONE_ID must name the Route 53 zone");
    expect(zoneless.calls).toEqual([]);

    for (const storeUrl of ["http://assets.example.org", "https://assets.example.org/blobs"]) {
      const result = run({ storeUrl });
      expect(result.status, storeUrl).toBe(1);
      expect(result.calls, storeUrl).toEqual([]);
    }
  });

  it("clears a first create that rolled back, then creates again", () => {
    const result = run({ env: { STUB_STATUS: "ROLLBACK_COMPLETE" } });
    expect(result.status, result.stderr).toBe(0);
    const order = result.calls.map((call) => call.split(" ").slice(0, 2).join(" "));
    expect(order.indexOf("cloudformation delete-stack")).toBeGreaterThan(-1);
    expect(order.indexOf("cloudformation delete-stack")).toBeLessThan(order.indexOf("cloudformation wait"));
    expect(order.indexOf("cloudformation wait")).toBeLessThan(order.indexOf("cloudformation deploy"));
  });

  it("never deletes a stack that is merely there", () => {
    for (const status of ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"]) {
      const result = run({ env: { STUB_STATUS: status } });
      expect(result.status, status).toBe(0);
      expect(result.calls.some((call) => call.includes("delete-stack")), status).toBe(false);
    }
  });

  it("stops, rather than drop the budget, when it cannot read the alarm topic", () => {
    const result = run({ env: { STUB_PROD_ERROR: "An error occurred (Throttling) when calling the DescribeStacks operation: Rate exceeded" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not read stack kad-prod");
    expect(result.deploy).toBeUndefined();
  });

  it("deploys with no budget only where there is no production stack to alert", () => {
    const result = run({ env: { STUB_PROD_GONE: "1" } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.deploy).toContain("AlarmTopicArn= MonthlyBudgetUsd=10");
    expect(result.stdout).toContain("no budget on this run");
  });

  it("stops when production is there but names no alarm topic, which would remove the budget it has", () => {
    // "None" is the CLI's text for a missing output; empty is one with no value.
    for (const topic of ["None", ""]) {
      const result = run({ env: { STUB_TOPIC: topic } });
      expect(result.status, topic).toBe(1);
      expect(result.stderr, topic).toContain("kad-prod exists but has no AlarmTopicArn output");
      expect(result.deploy, topic).toBeUndefined();
      expect(result.calls.some((call) => call.includes("delete-stack")), topic).toBe(false);
    }
  });

  it("serves a fork with no domain on the CDN's own host, asking for no zone", () => {
    const result = run({
      storeUrl: "https://d111111abcdef8.cloudfront.net",
      env: { APP_HOSTED_ZONE_ID: "", STUB_SERVES: "https://d111111abcdef8.cloudfront.net" },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.deploy).toContain("StoreDomainName= HostedZoneId= ");
  });

  it("fails when the stack serves somewhere the repo does not name", () => {
    const result = run({ env: { STUB_SERVES: "https://d111111abcdef8.cloudfront.net" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("says the store is at https://assets.example.org, but the stack serves at https://d111111abcdef8.cloudfront.net");
  });

  it("fails when the declared address does not answer", () => {
    const result = run({ env: { STUB_HTTP: "000" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("https://assets.example.org does not answer");
  });

  it("fails when it answers, but not as a healthy store: a server error, or a bucket that is not there", () => {
    for (const status of ["503", "502", "504", "500", "404"]) {
      const result = run({ env: { STUB_HTTP: status } });
      expect(result.status, status).toBe(1);
      expect(result.stderr, status).toContain(`https://assets.example.org answers HTTP ${status}, which is not a healthy store`);
      // Asked again before giving up: a new distribution can take a minute.
      expect(result.calls.filter((call) => call.startsWith("curl ")), status).toHaveLength(12);
    }
  });

  it("takes the store's own root answer, and a root that one day serves a page, as healthy", () => {
    for (const status of ["403", "200"]) {
      const result = run({ env: { STUB_HTTP: status } });
      expect(result.status, status).toBe(0);
      expect(result.calls.filter((call) => call.startsWith("curl ")), status).toHaveLength(1);
    }
  });

  it("says what CloudFormation refused when the deploy fails, and where the role's permissions are written down", () => {
    const result = run({ env: { STUB_DEPLOY_FAILS: "1" } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("StoreBudget CREATE_FAILED not authorized");
    expect(result.stderr).toContain("What the deploy role needs");
  });
});
