/**
 * The live bake-off page's server — `npm run voice:bakeoff -- --serve`
 * (docs/voice-bakeoff.md).
 *
 * Serves the page and the clips, and does the provider calls the page asks
 * for: list a key's models and voices, price a column, render a cell. Keys are
 * typed into the page and sent here with each call; they go from here to the
 * provider and are never written down. The browser never calls a provider
 * itself, so there is no CORS to fight and no key in a page script.
 *
 * It listens on 127.0.0.1 only, and every API call must carry the token printed
 * into the page, so another site open in the same browser cannot drive it.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { cellOf, estimate, renderCell, type Workspace } from "./bakeoff.ts";
import { renderPage, type LiveConfig } from "./page.ts";
import { GEMINI_VOICES, engineOf, listModels, listVoices, type CastFile, type EngineConfig, type Fetch, type Keys, type ModelInfo } from "./providers.ts";
import type { Sample } from "./samples.ts";
import { renderCastPage } from "../cast/page.ts";
import { castPageData, createCastRoutes, type Budget } from "../cast/routes.ts";

export interface ServerOptions {
  ws: Workspace;
  samples: Sample[];
  tiers: Record<string, string>;
  catalog: ModelInfo[];
  presets: EngineConfig[];
  envKeys: Keys;
  fetch: Fetch;
  /** The most the server will spend before it refuses, adjustable from the page. */
  maxDollars: number;
  token?: string;
  /** The cast sheet, for the /cast page (docs/voice-cast.md). Without it there is no cast page. */
  cast?: { sheetPath: string; chapterCampaigns: Record<string, string> };
}

type CastOverrides = Record<string, { elevenlabs?: string; gemini?: string }>;

const MODEL_ID = /^[A-Za-z0-9._-]{1,80}$/;
const CLIP = /^[a-f0-9]{24}(\.raw)?\.(mp3|wav)$/;

class BadRequest extends Error {}

function engineFrom(value: unknown, catalog: readonly ModelInfo[]): ReturnType<typeof engineOf> {
  const v = (value ?? {}) as Partial<EngineConfig>;
  if (v.provider !== "elevenlabs" && v.provider !== "gemini" && v.provider !== "fake") throw new BadRequest("provider must be elevenlabs, gemini or fake");
  // The model goes into a provider URL, so it is held to the characters model ids use.
  if (typeof v.model !== "string" || !MODEL_ID.test(v.model)) throw new BadRequest("model must be a provider model id");
  if (v.mode !== "lines" && v.mode !== "dialogue") throw new BadRequest("mode must be lines or dialogue");
  if (v.delivery !== "tag" && v.delivery !== "instruction" && v.delivery !== "none") throw new BadRequest("delivery must be tag, instruction or none");
  return engineOf({ provider: v.provider, model: v.model, mode: v.mode, delivery: v.delivery, context: v.context === true }, catalog);
}

/** The cast with the page's voice choices laid over it. */
export function castWith(cast: CastFile, overrides: unknown): CastFile {
  if (overrides === null || typeof overrides !== "object") return cast;
  const speakers = { ...cast.speakers };
  for (const [id, choice] of Object.entries(overrides as CastOverrides)) {
    const base = speakers[id];
    if (base === undefined) continue;
    speakers[id] = {
      ...base,
      ...(typeof choice.elevenlabs === "string" && choice.elevenlabs ? { elevenlabs: { voiceId: choice.elevenlabs } } : {}),
      ...(typeof choice.gemini === "string" && choice.gemini ? { gemini: { voice: choice.gemini } } : {}),
    };
  }
  return { ...cast, speakers };
}

function keysFrom(request: http.IncomingMessage, env: Keys): Keys {
  const header = (name: string): string | undefined => {
    const value = request.headers[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  return { elevenlabs: header("x-elevenlabs-key") ?? env.elevenlabs, gemini: header("x-gemini-key") ?? env.gemini };
}

async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new BadRequest("request too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new BadRequest("body must be JSON");
  }
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

export function createBakeoffServer(options: ServerOptions): { server: http.Server; token: string } {
  const token = options.token ?? randomBytes(16).toString("hex");
  // One budget for the whole session, whichever page spends it.
  const budget: Budget = { spent: 0, cap: options.maxDollars };
  const castRoutes = options.cast
    ? createCastRoutes({ ws: options.ws, sheetPath: options.cast.sheetPath, catalog: options.catalog, fetch: options.fetch, chapterCampaigns: options.cast.chapterCampaigns }, budget)
    : null;

  const takesFrom = (body: Record<string, unknown>): number => {
    const takes = Number(body.takes ?? 1);
    if (!Number.isInteger(takes) || takes < 1 || takes > 5) throw new BadRequest("takes must be 1 to 5");
    return takes;
  };
  const samplesFrom = (body: Record<string, unknown>): Sample[] => {
    if (!Array.isArray(body.samples)) return options.samples;
    const ids = new Set(body.samples.map(String));
    return options.samples.filter((s) => ids.has(s.id));
  };
  const wsWith = (body: Record<string, unknown>): Workspace => ({ ...options.ws, cast: castWith(options.ws.cast, body.cast) });

  const live = (): LiveConfig => ({
    token,
    catalog: options.catalog,
    presets: options.presets,
    speakers: options.ws.cast.speakers,
    geminiVoices: GEMINI_VOICES.map((v) => ({ id: v.id, name: v.id, about: v.about })),
    cap: budget.cap,
    envKeys: { elevenlabs: !!options.envKeys.elevenlabs, gemini: !!options.envKeys.gemini },
  });

  async function api(route: string, request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.headers["x-bakeoff-token"] !== token) return send(response, 403, { error: "Reload the page: this server was restarted." });
    const body = request.method === "POST" ? await readBody(request) : {};
    const keys = keysFrom(request, options.envKeys);
    switch (route) {
      case "/api/models": {
        const provider = engineFrom({ provider: body.provider, model: "x", mode: "lines", delivery: "none" }, []).provider;
        return send(response, 200, { models: await listModels(provider, keys, options.fetch) });
      }
      case "/api/voices": {
        const provider = engineFrom({ provider: body.provider, model: "x", mode: "lines", delivery: "none" }, []).provider;
        return send(response, 200, { voices: await listVoices(provider, keys, options.fetch) });
      }
      case "/api/columns": {
        // Every column's cells from disk, and what rendering the rest would cost. Sends nothing.
        const ws = wsWith(body);
        const takes = takesFrom(body);
        const engines = (Array.isArray(body.engines) ? body.engines : []).map((e) => engineFrom(e, options.catalog));
        return send(response, 200, {
          engines: engines.map((e) => ({ id: e.id, label: e.label, provider: e.provider, model: e.model, mode: e.mode, delivery: e.delivery, context: e.context === true })),
          estimates: engines.map((e) => estimate(e, options.samples, takes, ws)),
          cells: Object.fromEntries(engines.map((e) => [e.id, Object.fromEntries(options.samples.map((s) => [s.id, cellOf(e, s, takes, ws)]))])),
          spent: budget.spent,
          cap: budget.cap,
        });
      }
      case "/api/cap": {
        const next = Number(body.cap);
        if (!Number.isFinite(next) || next < 0) throw new BadRequest("cap must be a number of dollars");
        budget.cap = next;
        return send(response, 200, { spent: budget.spent, cap: budget.cap });
      }
      case "/api/render": {
        const ws = wsWith(body);
        const takes = takesFrom(body);
        const engine = engineFrom(body.engine, options.catalog);
        const [sample] = samplesFrom({ samples: [body.sample] });
        if (sample === undefined) throw new BadRequest("unknown sample");
        const quoted = estimate(engine, [sample], takes, ws);
        // An unpriced paid model is never treated as free: it renders only at a rate the page approved.
        let price = quoted.dollars;
        if (price === null && quoted.requests > 0) {
          const rate = typeof body.approvedRate === "number" && Number.isFinite(body.approvedRate) && body.approvedRate >= 0 ? body.approvedRate : null;
          if (rate === null) {
            return send(response, 409, { error: `pricing.json has no price for ${engine.model}, so the cap cannot be kept. Add it to tools/voice/pricing.json, or approve a rate on the column.`, spent: budget.spent, cap: budget.cap });
          }
          price = (quoted.chars / 1000) * rate;
        }
        price ??= 0;
        if (budget.spent + price > budget.cap + 1e-9) {
          return send(response, 402, { error: `This would take the session past its $${budget.cap.toFixed(2)} cap ($${budget.spent.toFixed(2)} spent, this cell about $${price.toFixed(2)}). Raise the cap to go on.`, spent: budget.spent, cap: budget.cap });
        }
        budget.spent += price;
        const cell = await renderCell(engine, sample, takes, ws, keys, options.fetch);
        return send(response, 200, { cell, spent: budget.spent, cap: budget.cap });
      }
      default: {
        const reply = castRoutes ? await castRoutes(route, body, keys) : null;
        if (reply) return send(response, reply.status, reply.body);
        return send(response, 404, { error: "no such route" });
      }
    }
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    void (async () => {
      try {
        if (url.pathname === "/" && request.method === "GET") {
          const page = renderPage({ generated: new Date().toISOString(), tiers: options.tiers, samples: options.samples, engines: [], cells: {} }, live());
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          return response.end(page);
        }
        if (url.pathname === "/cast" && request.method === "GET" && options.cast) {
          const page = renderCastPage(castPageData({ ws: options.ws, sheetPath: options.cast.sheetPath, catalog: options.catalog, fetch: options.fetch, chapterCampaigns: options.cast.chapterCampaigns }), {
            token,
            cap: budget.cap,
            envKeys: { elevenlabs: !!options.envKeys.elevenlabs, gemini: !!options.envKeys.gemini },
          });
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          return response.end(page);
        }
        if (url.pathname.startsWith("/clips/") && request.method === "GET") {
          const name = url.pathname.slice("/clips/".length);
          const file = path.join(options.ws.outDir, "clips", name);
          if (!CLIP.test(name) || !fs.existsSync(file)) return send(response, 404, { error: "no such clip" });
          // A clip's name is a hash of what made it, so it never changes.
          response.writeHead(200, { "content-type": name.endsWith(".mp3") ? "audio/mpeg" : "audio/wav", "cache-control": "public, max-age=31536000, immutable" });
          return fs.createReadStream(file).pipe(response);
        }
        if (url.pathname.startsWith("/api/")) return await api(url.pathname, request, response);
        send(response, 404, { error: "not found" });
      } catch (error) {
        if (!response.headersSent) send(response, error instanceof BadRequest ? 400 : 502, { error: (error as Error).message });
      }
    })();
  });
  return { server, token };
}
