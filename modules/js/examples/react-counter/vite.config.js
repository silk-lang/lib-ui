import { defineConfig } from "vite";

// One self-contained ES module: the ui-js host evaluates it as the entry module.
export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  oxc: { jsx: { runtime: "automatic", importSource: "@silk/ui-react" } },
  build: {
    target: "es2022",
    minify: false,
    lib: { entry: "src/main.jsx", formats: ["es"], fileName: () => "app.js" },
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
