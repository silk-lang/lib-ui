import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The benchmark app for a browser engine (Electron, Tauri): dist/web, loaded from files.
export default defineConfig({
  root: fileURLToPath(new URL("app/web", import.meta.url)),
  base: "./",
  resolve: { alias: { platform: fileURLToPath(new URL("app/web/platform.js", import.meta.url)) } },
  oxc: { jsx: { runtime: "automatic" } },
  build: { outDir: fileURLToPath(new URL("dist/web", import.meta.url)), emptyOutDir: true, target: "es2022" },
});
