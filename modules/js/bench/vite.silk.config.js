import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import silk from "@silk/vite";

// The benchmark app for the tree: dist/silk/app.js, one ES module a ui-js host runs.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { platform: fileURLToPath(new URL("app/silk/platform.js", import.meta.url)) } },
  build: { outDir: "dist/silk", emptyOutDir: true },
  plugins: [silk({ entry: "app/silk/main.jsx" })],
});
