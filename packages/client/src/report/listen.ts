/**
 * The only part of crash reporting (#317) in the first paint: two listeners
 * that hand whatever was thrown to `report.ts`, which loads on the first one.
 * React 19 re-raises an error no boundary caught as a window `error`, so a
 * render crash arrives here too. A failed load is swallowed, because a
 * reporter that can throw would report itself forever.
 */
import { listenForWorkerErrors } from "./worker-errors";

const hand =(thrown: unknown) =>
  import("./report").then((m) => m.report(thrown)).catch(() => {});
addEventListener("error", (e) => hand(e.error ?? e.message));
addEventListener("unhandledrejection", (e) => hand(e.reason));
// The service worker's failures (#459) arrive as messages; the reporter loads with the first.
listenForWorkerErrors(typeof navigator === "undefined" ? undefined : navigator.serviceWorker, hand);
