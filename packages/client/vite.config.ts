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
  },
});
