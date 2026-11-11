/**
 * API keys for the MCP server (docs/mcp-server.md, "Keys").
 *
 * Modeled on content-tracking's API keys: a row per key with a label, what the
 * key may do, when it was made and last used; the key itself shown once at mint
 * and never stored; revoking deletes the row, and the next call fails. Two
 * differences, both on purpose:
 *
 *  - **No signing key.** A key is `kadmcp_<id>.<secret>`, and the row keeps the
 *    SHA-256 of the secret. content-tracking signs its tokens so the authorizer
 *    can verify without a database read, then reads the row anyway to check
 *    revocation. Every call here reads the row too, so a signature would add a
 *    secret to manage and buy nothing. The secret is 32 random bytes, so a plain
 *    hash is the right tool (a password hash is for guessable inputs).
 *  - **Scopes, not one read/write level.** A key is granted per area:
 *    `assets:write` lets an agent request upload URLs; `operator:read` is for the
 *    operator tools. An agent's upload key never sees operator data. Within an
 *    area, `:read` reaches only tools annotated readOnlyHint, as there.
 *
 * Minted by an operator with AWS credentials (`npm run mcp:keys`), never through
 * the MCP server or the game's API: sign-up here is open to any family, so a
 * Cognito user is no proof of being the operator, and a key must never be able
 * to mint another.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const AREAS = ["assets", "operator"] as const;
export type Area = (typeof AREAS)[number];
export type Scope = `${Area}:read` | `${Area}:write`;
export const SCOPES: readonly Scope[] = AREAS.flatMap((a) => [`${a}:read`, `${a}:write`] as Scope[]);

export const KEY_PREFIX = "kadmcp_";
const KEY_SHAPE = /^kadmcp_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;

export const DEFAULT_KEY_DAYS = 90;
/**
 * An agent name and tags are stamped, in public, on every blob a key uploads (#732), so they
 * are short plain words: no spaces, no personal data, no secrets.
 */
const AGENT_SHAPE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const TAG_KEY_SHAPE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const TAG_VALUE_SHAPE = /^[A-Za-z0-9._:/-]{1,64}$/;
const MAX_TAGS = 8;
export const MAX_KEY_DAYS = 366;
const LABEL_MAX = 60;

/** The stored row. Never holds the key. */
export interface KeyRecord {
  id: string;
  label: string;
  scopes: Scope[];
  /** The agent the key was minted for (e.g. "codex"), stamped on its uploads. */
  agent: string | null;
  /** Free-form tags (e.g. env=codex-cloud), stamped on its uploads. */
  tags: Record<string, string>;
  /** Hex SHA-256 of the key's secret half. */
  secretHash: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
}

/** What `list` and `create` show: the row without the hash. */
export type KeyInfo = Omit<KeyRecord, "secretHash">;

export interface KeyStore {
  get(id: string): Promise<KeyRecord | null>;
  /** Fails if a row with this id exists. */
  create(record: KeyRecord): Promise<void>;
  list(): Promise<KeyRecord[]>;
  /** Returns whether a row was deleted. */
  delete(id: string): Promise<boolean>;
  touch(id: string, at: string): Promise<void>;
}

export class KeyError extends Error {}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

export function publicInfo(record: KeyRecord): KeyInfo {
  const { secretHash: _hidden, ...info } = record;
  return info;
}

export interface MintInput {
  label: string;
  scopes: string[];
  agent?: string;
  /** `key=value` pairs, or an object. */
  tags?: string[] | Record<string, string>;
  days?: number;
  now?: Date;
}

/** Make a key. The returned `key` is the only copy that will ever exist. */
export async function mintKey(store: KeyStore, input: MintInput): Promise<{ key: string; info: KeyInfo }> {
  const label = input.label.trim();
  if (!label || label.length > LABEL_MAX) throw new KeyError(`A label of 1 to ${LABEL_MAX} characters says who holds the key.`);
  if (input.scopes.length === 0) throw new KeyError(`Name at least one scope: ${SCOPES.join(", ")}.`);
  const bad = input.scopes.filter((s) => !isScope(s));
  if (bad.length > 0) throw new KeyError(`Unknown scope ${bad.join(", ")}. Scopes: ${SCOPES.join(", ")}.`);
  if (/[^A-Za-z0-9 ._:/-]/.test(label)) throw new KeyError("A label is plain words (letters, digits, spaces, . _ : / -): it is stamped, in public, on every blob the key uploads.");
  const agent = input.agent?.trim() || null;
  if (agent !== null && !AGENT_SHAPE.test(agent)) throw new KeyError("An agent is one lower-case word (letters, digits, . _ -), e.g. codex.");
  const tags = parseTags(input.tags);
  const days = input.days ?? DEFAULT_KEY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_KEY_DAYS) throw new KeyError(`A key lives 1 to ${MAX_KEY_DAYS} days.`);

  const now = input.now ?? new Date();
  // Hex, not base64url: an id is typed on a command line (`mcp:keys revoke <id>`), and a
  // base64url one starts with "-" about one time in 64, which a parser reads as an option.
  // 64 bits is plenty for an id; the secret half is what must not be guessed.
  const id = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const record: KeyRecord = {
    id,
    label,
    scopes: [...new Set(input.scopes as Scope[])].sort(),
    agent,
    tags,
    secretHash: hashSecret(secret),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    lastUsedAt: null,
  };
  await store.create(record);
  return { key: `${KEY_PREFIX}${id}.${secret}`, info: publicInfo(record) };
}

export interface VerifiedKey {
  id: string;
  label: string;
  scopes: Scope[];
  agent: string | null;
  tags: Record<string, string>;
  expiresAt: string;
}

/**
 * The key's grant, or null for anything that is not a live key: malformed,
 * unknown, revoked, expired or wrong secret all look the same to the caller.
 * Records the use; a failure to record it never fails the call.
 */
export async function verifyKey(store: KeyStore, presented: string, now: Date = new Date()): Promise<VerifiedKey | null> {
  const m = KEY_SHAPE.exec(presented);
  if (!m) return null;
  const [, id, secret] = m as unknown as [string, string, string];
  const record = await store.get(id);
  if (!record) return null;
  const want = Buffer.from(record.secretHash, "hex");
  const got = Buffer.from(hashSecret(secret), "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (Date.parse(record.expiresAt) <= now.getTime()) return null;
  await store.touch(id, now.toISOString()).catch(() => undefined);
  return {
    id: record.id,
    label: record.label,
    scopes: record.scopes.filter(isScope),
    agent: record.agent ?? null,
    tags: record.tags ?? {},
    expiresAt: record.expiresAt,
  };
}

export async function listKeys(store: KeyStore): Promise<KeyInfo[]> {
  const rows = await store.list();
  return rows.map(publicInfo).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function revokeKey(store: KeyStore, id: string): Promise<void> {
  if (!(await store.delete(id))) throw new KeyError(`No key ${id}.`);
}

function parseTags(input: MintInput["tags"]): Record<string, string> {
  const pairs: Array<[string, string]> = Array.isArray(input)
    ? input.map((raw) => {
        const eq = raw.indexOf("=");
        if (eq <= 0) throw new KeyError(`A tag is key=value: ${raw}`);
        return [raw.slice(0, eq).trim(), raw.slice(eq + 1).trim()];
      })
    : Object.entries(input ?? {});
  if (pairs.length > MAX_TAGS) throw new KeyError(`At most ${MAX_TAGS} tags.`);
  const tags: Record<string, string> = {};
  for (const [k, v] of pairs) {
    if (!TAG_KEY_SHAPE.test(k)) throw new KeyError(`A tag's key is one lower-case word: ${k}`);
    if (!TAG_VALUE_SHAPE.test(v)) throw new KeyError(`A tag's value is up to 64 plain characters (letters, digits, . _ : / -): ${k}=${v}`);
    tags[k] = v;
  }
  return tags;
}

/** The bearer key from an Authorization header value, or null. */
export function bearerKey(header: string | undefined | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1]! : null;
}

export class MemoryKeyStore implements KeyStore {
  readonly rows = new Map<string, KeyRecord>();
  get(id: string): Promise<KeyRecord | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row ? { ...row } : null);
  }
  create(record: KeyRecord): Promise<void> {
    if (this.rows.has(record.id)) return Promise.reject(new KeyError("id taken"));
    this.rows.set(record.id, { ...record });
    return Promise.resolve();
  }
  list(): Promise<KeyRecord[]> {
    return Promise.resolve([...this.rows.values()].map((r) => ({ ...r })));
  }
  delete(id: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }
  touch(id: string, at: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.lastUsedAt = at;
    return Promise.resolve();
  }
}
