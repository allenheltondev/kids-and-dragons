/**
 * Entry point. One bundle serves the TV and the phones; which one you are is a
 * route (architecture §1).
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/theme.css";
import "./styles/components.css";

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
