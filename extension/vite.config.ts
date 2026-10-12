import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { resolve } from "node:path";

// One build: the popup, the full-page app (onboarding, Flipper pairing), the offscreen document
// that keeps the engine running, and the service worker (fixed name, for the manifest).
export default defineConfig(({ mode }) => ({
  plugins: [preact()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome116",
    sourcemap: mode === "development",
    minify: mode !== "development",
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        app: resolve(__dirname, "app.html"),
        sidepanel: resolve(__dirname, "sidepanel.html"),
        offscreen: resolve(__dirname, "offscreen.html"),
        background: resolve(__dirname, "src/background/main.ts"),
      },
      output: {
        entryFileNames: (c) => (c.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  worker: { format: "es" },
}));
