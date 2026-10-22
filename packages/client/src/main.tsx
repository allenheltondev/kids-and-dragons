/**
 * Entry point. One bundle serves the TV and the phones; which one you are is a
 * route (architecture §1).
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./report/listen";
import { startA11y } from "./a11y/prefs";
import { App } from "./App";
import { listenForInstallPrompt } from "./install/prompt";
import { registerServiceWorker } from "./sw/register";
import "./styles/theme.css";
import "./styles/components.css";

// Saved text size, contrast, motion and reach, before the first paint (#262).
startA11y();

// Chromium offers installing once, early, and may do it before the home screen
// mounts: hold the offer for the home screen's install card (#412).
listenForInstallPrompt(window);

const host = document.getElementById("root");
if (!host) throw new Error("#root is missing from index.html");

createRoot(host).render(
  // Strict mode stays on in dev deliberately: it double-invokes effects, which
  // is how the Pixi teardown in world/PixiStage.tsx and the channel teardown in
  // sync/channel.ts get exercised on every save instead of on a TV at bedtime.
  <StrictMode>
    <App />
  </StrictMode>,
);

// The offline adventure book (src/sw/). Production builds only.
registerServiceWorker();
