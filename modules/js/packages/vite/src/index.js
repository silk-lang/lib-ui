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
import { missingApis, ownerOf, report } from "./apis.js";
import { devPlugins } from "./dev.js";
import { reconcilerPlugin } from "./reconciler.js";

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
 * @param {"warn" | "error" | "off"} [options.apis] What to do when the application or one
 *   of its libraries uses a web or Node API a ui-js runtime does not have. Default `warn`.
 * @param {string[]} [options.allow] Such APIs the application provides itself.
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
  const apis = options.apis ?? "warn";
  const allow = new Set(options.allow ?? []);
  let root = "";
  let serving = false;
  /** name → { area, owners } */
  const uses = new Map();
  const apiPlugin = {
    name: "silk:apis",
    enforce: "post",

    configResolved(config) {
      root = config.root;
      serving = config.command === "serve";
    },

    buildStart() {
      uses.clear();
    },

    // After the other transforms, so what is scanned is JavaScript.
    transform(code, id) {
      if (apis === "off" || id.startsWith("\0")) return;
      if (serving && this.environment.name !== "silk") return;
      if (!/\.[cm]?[jt]sx?$/.test(id.split("?")[0])) return;
      let ast;
      try {
        ast = this.parse(code);
      } catch {
        return;
      }
      const owner = ownerOf(id, root);
      for (const { name, area } of missingApis(ast)) {
        if (allow.has(name)) continue;
        let use = uses.get(name);
        if (!use) uses.set(name, (use = { area, owners: new Set() }));
        if (use.owners.has(owner)) continue;
        use.owners.add(owner);
        // The dev server has no end to report at: say it when the module is first served.
        if (serving) this.warn(`${name} (${area}) is not in a ui-js runtime, and ${owner} uses it`);
      }
    },

    buildEnd(error) {
      if (error || serving || uses.size === 0) return;
      if (apis === "error") this.error(report(uses));
      this.warn(report(uses));
    },
  };

  return [buildPlugin, apiPlugin, reconcilerPlugin(), ...devPlugins({ entry, jsx, refresh: options.refresh ?? true, port: options.port ?? 0, host: options.host })];
}
