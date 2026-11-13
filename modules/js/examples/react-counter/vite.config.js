import { defineConfig } from "vite";
import silk from "@silk/vite";

// `npm run build` writes dist/app.js. `npm run dev` rebuilds on every change and, when
// SILK_UI_HOST names a ui-js host binary, opens it and reloads the app after each build.
const host = process.env.SILK_UI_HOST;

export default defineConfig({
  plugins: [
    silk({
      // The demo host reads its fonts and @silk/ui from the repository root.
      host: host ? { command: host, cwd: new URL("../../../..", import.meta.url).pathname } : undefined,
    }),
  ],
});
