import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * `/assets` and `/content` are proxied to the dev server in development and
 * served from the same origin by CloudFront in production, so client code uses
 * identical URLs in both. Nothing here is client-only.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/events": { target: "http://localhost:8787", changeOrigin: true },
      "/assets": { target: "http://localhost:8787", changeOrigin: true },
      "/content": { target: "http://localhost:8787", changeOrigin: true },
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
