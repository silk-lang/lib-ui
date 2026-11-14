import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// The same page in a browser: `npm run dev:web`. src/ is compiled unchanged, with `<box>`
// as a div that takes the tree's props, from the starter page's web build.
const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  root: path("web/"),
  base: "./",
  resolve: {
    alias: [
      { find: /^@silk\/ui$/, replacement: path("../react-counter/web/silk-ui.js") },
      { find: /^silk-web\/jsx(-dev)?-runtime$/, replacement: path("../react-counter/web/jsx-runtime.js") },
    ],
  },
  server: { fs: { allow: [path("../../..")] } },
  oxc: { jsx: { runtime: "automatic", importSource: "silk-web" } },
  build: { outDir: path("dist-web"), emptyOutDir: true, target: "es2022" },
});
