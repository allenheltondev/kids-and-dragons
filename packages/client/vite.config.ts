import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { serviceWorker } from "./sw-build";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const apiTarget = process.env.KAD_DEV_API_TARGET ?? "http://localhost:8787";

/**
 * `/assets` and `/content` are proxied to the dev server in development and
 * served from the same origin by CloudFront in production, so client code uses
 * identical URLs in both. Nothing here is client-only.
 */
export default defineConfig({
  // The service worker (src/sw/) is emitted as `/sw.js` by its own plugin:
  // a fixed URL and a single classic script, which a Vite entry is not.
  plugins: [react(), serviceWorker(`${repoRoot}content`)],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.KAD_CLIENT_PORT ?? 5173),
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/events": { target: apiTarget, changeOrigin: true },
      "/assets": { target: apiTarget, changeOrigin: true },
      "/content": { target: apiTarget, changeOrigin: true },
    },
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    /*
     * Not Vite's default of `assets`. In production the SPA, the commissioned
     * art, and the chapter JSON all sit in one S3 bucket behind one
     * distribution, and the art is already served at `/assets/*` — in dev by the
     * dev server, in prod by CloudFront, deliberately at the same URL. Leaving
     * this at the default would drop hashed JS chunks into that same prefix, so
     * a deploy syncing the bundle and a deploy syncing the art would each want
     * to delete the other's files.
     */
    assetsDir: "bundle",
  },
});
