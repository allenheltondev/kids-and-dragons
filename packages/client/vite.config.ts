import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { buildId, serviceWorker } from "./sw-build";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const apiTarget = process.env.KAD_DEV_API_TARGET ?? "http://localhost:8787";

/**
 * `/assets` and `/content` are proxied to the dev server in development and
 * served from the same origin by CloudFront in production, so client code uses
 * identical URLs in both. Nothing here is client-only.
 */
export default defineConfig({
  // Which build a crash report came from (#317): the commit CI built, else "dev".
  define: {
    "import.meta.env.VITE_KAD_BUILD": JSON.stringify(buildId()),
  },
  // The service worker (src/sw/) is emitted as `/sw.js` by its own plugin:
  // a fixed URL and a single classic script, which a Vite entry is not.
  plugins: [react(), serviceWorker(repoRoot)],
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
    /*
     * The painted chrome (src/assets/chrome/) stays files rather than data URLs, small as most of
     * it is: inlined, all of it rode in every stylesheet that dresses anything (the room's and the
     * journal's, ~96KB each), whether the screen used the piece or not. As files it is fetched
     * once, when drawn, and the service worker saves it like the rest of `/bundle/`.
     */
    assetsInlineLimit: (file) => (file.includes("/assets/chrome/") ? false : undefined),
  },
});
