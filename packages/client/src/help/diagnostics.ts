/**
 * The Diagnostics panel under Help (#459): what the installed app is doing,
 * for the grown-up who is helping, and for a tester's pass record
 * (docs/pwa-device-qa.md). Everything here is pure except `collectDiagnostics`,
 * the one function that asks the browser, and every ask in it is guarded: a
 * TV or an old phone is exactly where an API is missing, and a report that
 * throws is no use on the device it is for.
 */

import {
  SW_CACHES,
  SW_FILES_META_KEY,
  SW_PERIODIC_KEY,
  SW_PERIODIC_TAG,
  swPeriodicRecordOf,
  type FileMeta,
  type SwPeriodicRecord,
} from "../sw/policy";
import { browserEnv, isStandalone } from "../install/detect";

export type WorkerState = "none" | "installing" | "waiting" | "active";

export interface Diagnostics {
  build: string;
  worker: { state: WorkerState; script: string | null };
  /** Is a worker answering for this page? */
  controlled: boolean;
  standalone: boolean;
  /** Bytes in use and allowed, when the browser says. */
  storage: { usage: number; quota: number } | null;
  /** True, false, or null when the browser cannot say. */
  persisted: boolean | null;
  /** Files the app saved for offline, from the worker's own bookkeeping. */
  saved: { count: number; bytes: number } | null;
  /**
   * The overnight refresh (#467): whether it is registered (null where the
   * browser has no Periodic Background Sync), and the worker's record of its
   * last run.
   */
  periodic: { registered: boolean | null; lastRun: SwPeriodicRecord | null };
}

export interface DiagnosticRow {
  id: string;
  label: string;
  value: string;
}

/** `1.5 MB`: one decimal below ten, none above. Bytes are never negative or fractional here. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${String(Math.round(value))} bytes`;
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit]}`;
}

/** The registration's state: the furthest along of its workers. */
export function workerStateOf(
  registration: Pick<ServiceWorkerRegistration, "active" | "waiting" | "installing"> | null | undefined,
): WorkerState {
  if (!registration) return "none";
  if (registration.active) return "active";
  if (registration.waiting) return "waiting";
  if (registration.installing) return "installing";
  return "none";
}

/** How many files the worker has saved and what they weigh, from its bookkeeping entry. */
export function savedFilesOf(meta: unknown): { count: number; bytes: number } | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  let count = 0;
  let bytes = 0;
  for (const entry of Object.values(meta as Record<string, Partial<FileMeta> | null>)) {
    if (!entry || typeof entry.bytes !== "number") continue;
    count++;
    bytes += entry.bytes;
  }
  return { count, bytes };
}

/** `2026-10-24 06:12 UTC`: the same on every device, for a pass record. */
export function formatWhen(at: number): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "unknown";
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The overnight refresh, in words. */
export function periodicWords(periodic: Diagnostics["periodic"]): string {
  const last = periodic.lastRun;
  const ran = last ? `last ran ${formatWhen(last.at)}${last.outcome === "failed" ? ", and it went wrong" : ""}` : null;
  if (periodic.registered === null) return ran ? `Not on this device (${ran})` : "Not on this device";
  if (!periodic.registered) return ran ? `Off (${ran})` : "Off";
  return ran ? `On, ${ran}` : "On, not run yet";
}

const WORKER_WORDS: Record<WorkerState, string> = {
  none: "None",
  installing: "Getting ready",
  waiting: "Waiting its turn",
  active: "Ready",
};

/** The rows, in kid-safe words. Same rows on screen and in the copied text. */
export function diagnosticRows(d: Diagnostics): DiagnosticRow[] {
  const script = d.worker.script ? ` (${d.worker.script})` : "";
  return [
    { id: "build", label: "Build", value: d.build },
    { id: "worker", label: "Helper", value: `${WORKER_WORDS[d.worker.state]}${script}` },
    { id: "controlled", label: "Helper in charge of this page", value: d.controlled ? "Yes" : "No" },
    { id: "mode", label: "Opened as", value: d.standalone ? "An installed app" : "A browser tab" },
    {
      id: "storage",
      label: "Space used",
      value: d.storage ? `${formatBytes(d.storage.usage)} of ${formatBytes(d.storage.quota)}` : "Unknown",
    },
    {
      id: "persisted",
      label: "Space kept safe",
      value: d.persisted === null ? "Unknown" : d.persisted ? "Yes" : "No",
    },
    {
      id: "saved",
      label: "Saved for offline",
      value: d.saved ? `${String(d.saved.count)} ${d.saved.count === 1 ? "file" : "files"}, ${formatBytes(d.saved.bytes)}` : "Unknown",
    },
    { id: "periodic", label: "Overnight refresh", value: periodicWords(d.periodic) },
  ];
}

/** The plain text a tester pastes into the pass record. */
export function diagnosticsText(d: Diagnostics): string {
  return ["Kids & Dragons diagnostics", ...diagnosticRows(d).map((row) => `${row.label}: ${row.value}`)].join("\n");
}

/** Ask the browser. Every part falls back on its own. */
export async function collectDiagnostics(): Promise<Diagnostics> {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const registration = await attempt(() => nav?.serviceWorker?.getRegistration());
  const estimate = await attempt(() => nav?.storage?.estimate());
  const persisted = await attempt(() => nav?.storage?.persisted?.());
  const meta = await attempt(async () => {
    if (typeof caches === "undefined") return undefined;
    const saved = await (await caches.open(SW_CACHES.files)).match(SW_FILES_META_KEY);
    return saved ? ((await saved.json()) as unknown) : undefined;
  });
  const tags = await attempt(() =>
    (registration as (ServiceWorkerRegistration & { periodicSync?: { getTags(): Promise<string[]> } }) | undefined)?.periodicSync?.getTags(),
  );
  const lastRun = await attempt(async () => {
    if (typeof caches === "undefined") return undefined;
    const saved = await (await caches.open(SW_CACHES.files)).match(SW_PERIODIC_KEY);
    return saved ? ((await saved.json()) as unknown) : undefined;
  });
  const worker = registration?.active ?? registration?.waiting ?? registration?.installing;
  return {
    build: import.meta.env.VITE_KAD_BUILD,
    worker: { state: workerStateOf(registration), script: worker ? new URL(worker.scriptURL).pathname : null },
    controlled: nav?.serviceWorker?.controller != null,
    standalone: isStandalone(browserEnv()),
    storage:
      estimate && typeof estimate.usage === "number" && typeof estimate.quota === "number"
        ? { usage: estimate.usage, quota: estimate.quota }
        : null,
    persisted: typeof persisted === "boolean" ? persisted : null,
    saved: savedFilesOf(meta),
    periodic: {
      registered: Array.isArray(tags) ? tags.includes(SW_PERIODIC_TAG) : null,
      lastRun: swPeriodicRecordOf(lastRun),
    },
  };
}

async function attempt<T>(ask: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await ask();
  } catch {
    return undefined;
  }
}
