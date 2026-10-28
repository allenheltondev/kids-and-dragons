/**
 * The "no model at play time" invariant (architecture §6, #347) and the list of
 * hosts the shipped code may talk to (#525), as a test.
 *
 * Static, so it proves what the repository can do, not what a deployed stack is
 * doing: the stack's real parameters, roles and logs are checked by hand and
 * recorded in docs/review/us-third-party-flows.md. A failure here means someone
 * added a way for a player's words to reach a model or a new vendor. That needs
 * the legal-basis and notice review #525 asks for before it merges, so the fix is
 * a reviewed entry below, never a quiet edit to make the test pass.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNTIME_PACKAGES = ["canon", "client", "server", "shared"];

function walk(dir, keep) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".build") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

const isTest = (path) => /\.test\.[cm]?[jt]sx?$/.test(path);
const isSource = (path) => /\.[cm]?[jt]sx?$/.test(path) && !isTest(path);

const runtimeSource = RUNTIME_PACKAGES.flatMap((pkg) => walk(join(REPO, "packages", pkg, "src"), isSource));

/** Model and generation vendors. The offline voice tooling under tools/ may name them; shipped code may not. */
const MODEL_VENDORS = /bedrock|anthropic|openai|gemini|generativelanguage|elevenlabs|texttospeech|polly|vertexai|azure\.com\/openai|\bgpt-|\bclaude-/i;

describe("no model call at play time (#525)", () => {
  it("finds the runtime source it is meant to guard", () => {
    expect(runtimeSource.length).toBeGreaterThan(100);
  });

  it("no shipped package depends on a model or speech vendor SDK", () => {
    const sdk = /bedrock|anthropic|openai|genai|generative-ai|elevenlabs|polly|vertex|@google-cloud\/(text-to-speech|aiplatform)|ai-sdk|langchain/i;
    const offenders = [];
    for (const pkg of RUNTIME_PACKAGES) {
      const manifest = JSON.parse(readFileSync(join(REPO, "packages", pkg, "package.json"), "utf8"));
      for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
        for (const name of Object.keys(manifest[section] ?? {})) if (sdk.test(name)) offenders.push(`${pkg}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no shipped source names a model or generation vendor", () => {
    const offenders = [];
    for (const file of runtimeSource) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (MODEL_VENDORS.test(line)) offenders.push(`${relative(REPO, file)}:${String(i + 1)}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the stack grants no model permission and sets no live-model switch", () => {
    const files = [
      "infra/template.yaml",
      "infra/github-oidc.yaml",
      "infra/build.mjs",
      "scripts/deploy.sh",
      ...walk(join(REPO, ".github"), () => true).map((p) => relative(REPO, p)),
    ].filter((f) => existsSync(join(REPO, f)));
    const forbidden = /bedrock|sagemaker|LIVE_LLM|"?bedrock:|aws-sdk\/client-bedrock/i;
    const offenders = [];
    for (const file of files) {
      readFileSync(join(REPO, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (forbidden.test(line)) offenders.push(`${file}:${String(i + 1)}: ${line.trim().slice(0, 100)}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("hosts the shipped code may reach (#525)", () => {
  /*
   * Every literal host in shipped source. Each entry says who gets what, so
   * adding one is a visible, reviewable act. Template literals such as
   * `https://${x}` are matched by their variable's name instead.
   */
  const ALLOWED = {
    "kad.invalid": "a placeholder origin the service worker builds URLs against; never fetched (sw/policy.ts)",
    localhost: "the dev server's own address (dev-server.ts); not shipped to Lambda",
    "cognito-idp.${config.region}.amazonaws.com": "AWS Cognito: the grown-up's email and one-time code, sent from the browser (sync/auth.ts)",
    "${options.httpDomain}": "this stack's AppSync Events HTTP endpoint, server-side publish (channel/appsync-events-channel.ts)",
    "${entry.address}": "the dev server printing its LAN address (dev-server.ts)",
  };

  it("shipped source reaches only the reviewed hosts", () => {
    const seen = new Map();
    for (const file of runtimeSource) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.${}_-]+)/g)) {
        const host = match[1];
        if (host === "www.w3.org" || host.endsWith("w3.org")) continue;
        const line = text.slice(0, match.index).split("\n").length;
        seen.set(host, `${relative(REPO, file)}:${String(line)}`);
      }
    }
    const unreviewed = [...seen].filter(([host]) => !(host in ALLOWED)).map(([host, where]) => `${host} (${where})`);
    expect(unreviewed).toEqual([]);
  });

  it("the page loads no third-party script, style, font or frame", () => {
    const html = readFileSync(join(REPO, "packages", "client", "index.html"), "utf8");
    const external = [...html.matchAll(/<(?:script|link|iframe|img|source)\b[^>]*\b(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\/[^"']+/gi)].map((m) => m[0]);
    expect(external).toEqual([]);
  });
});
