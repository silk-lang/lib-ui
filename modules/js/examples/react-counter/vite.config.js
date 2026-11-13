import { defineConfig } from "vite";
import silk from "@silk/vite";

// `npm run build` writes dist/app.js. `npm run dev` serves the modules to a ui-js host and
// replaces the ones an edit touches, keeping component state. `npm run watch` rebuilds
// the bundle on every change and reloads the whole application. Both open the host that
// SILK_UI_HOST names.
const host = process.env.SILK_UI_HOST;

export default defineConfig({
  plugins: [
    silk({
      // The demo host reads its fonts and @silk/ui from the repository root.
      host: host ? { command: host, cwd: new URL("../../../..", import.meta.url).pathname } : undefined,
    }),
  ],
});
