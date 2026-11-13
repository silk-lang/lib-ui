// Vite plugin for ui-js applications.
//
// A ui-js host evaluates one ES module, so the plugin configures a library build with a
// single output file. After each successful build it writes `<bundle>.stamp`; a host
// started with --watch reloads the application when that file changes. With `host` set
// and `vite build --watch`, the plugin starts the host after the first build.
//
// Under `vite` (the dev server) the host runs the application's modules as Vite serves
// them, and an edit replaces only the modules it touches: see dev.js.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { devPlugins } from "./dev.js";

/**
 * @param {object} [options]
 * @param {string} [options.entry] Entry module, relative to the Vite root. Default `src/main.jsx`.
 * @param {string} [options.fileName] Name of the bundle in `build.outDir`. Default `app.js`.
 * @param {string | false} [options.jsx] Package whose JSX runtime compiles JSX, or false to
 *   leave JSX settings alone. Default `@silk/ui-react`.
 * @param {{ command: string, args?: string[], cwd?: string }} [options.host] Host binary to
 *   start. In watch mode it is given `--watch <bundle>` after `args`, under the dev
 *   server `--dev <port>`.
 * @param {boolean} [options.refresh] React Fast Refresh under the dev server. Default true.
 * @param {number} [options.port] Port the dev server listens on for the host. Default: any
 *   free one.
 */
export default function silk(options = {}) {
  const entry = options.entry ?? "src/main.jsx";
  const fileName = options.fileName ?? "app.js";
  const jsx = options.jsx ?? "@silk/ui-react";
  let bundle = "";
  let watching = false;
  let child = null;

  function startHost() {
    const { command, args = [], cwd } = options.host;
    child = spawn(command, [...args, "--watch", bundle], { cwd, stdio: "inherit" });
    child.on("error", (error) => {
      console.error(`[silk] could not start ${command}: ${error.message}`);
    });
    // Closing the window ends the dev session.
    child.on("exit", (code) => process.exit(code ?? 0));
    process.on("exit", () => child.kill());
  }

  const buildPlugin = {
    name: "silk",
    apply: "build",

    config(_user, { mode }) {
      const config = {
        // Libraries read it to pick their development or production build.
        define: { "process.env.NODE_ENV": JSON.stringify(mode === "development" ? "development" : "production") },
        build: {
          target: "es2022",
          minify: mode !== "development",
          lib: { entry, formats: ["es"], fileName: () => fileName },
          rolldownOptions: { output: { codeSplitting: false } },
        },
      };
      if (jsx !== false) config.oxc = { jsx: { runtime: "automatic", importSource: jsx } };
      return config;
    },

    configResolved(config) {
      bundle = resolve(config.root, config.build.outDir, fileName);
      watching = config.build.watch != null;
    },

    // Runs only after a build that wrote its files, so a failed build keeps the old app.
    writeBundle() {
      writeFileSync(`${bundle}.stamp`, `${Date.now()}\n`);
      if (watching && options.host && child === null) startHost();
    },
  };
  return [buildPlugin, ...devPlugins({ entry, jsx, refresh: options.refresh ?? true, port: options.port ?? 0, host: options.host })];
}
