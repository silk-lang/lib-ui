import { defineConfig } from "vite";
import silk from "@silk/vite";

// `npm run build` writes dist/app.js for a ui-js host (see the README).
export default defineConfig({ plugins: [silk()] });
