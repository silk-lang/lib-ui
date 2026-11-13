import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The same page for a browser engine: `npm run build:web` writes dist-web/, which the
// Electron and Tauri shells load; `npm run dev:web` serves it to any browser. src/ is
// compiled unchanged: `<box>` is a div with the tree's props (web/box.js) and @silk/ui is
// the part of it the page uses, on elements (web/silk-ui.js).
const web = (path) => fileURLToPath(new URL("web/" + path, import.meta.url));

export default defineConfig({
  root: web(""),
  base: "./",
  resolve: {
    alias: [
      { find: /^@silk\/ui$/, replacement: web("silk-ui.js") },
      { find: /^silk-web\/jsx(-dev)?-runtime$/, replacement: web("jsx-runtime.js") },
    ],
  },
  oxc: { jsx: { runtime: "automatic", importSource: "silk-web" } },
  build: { outDir: fileURLToPath(new URL("dist-web", import.meta.url)), emptyOutDir: true, target: "es2022" },
});
