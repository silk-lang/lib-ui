// Runs inside the realm of a ui-js host in development: Vite's module runner over the
// host's line transport (`__ui.devSend` out, `__ui.devMessage` in).
import "./dev-shims.js";
import { ModuleRunner, ESModulesEvaluator } from "vite/module-runner";

const native = globalThis.__ui;
let handlers = null;

native.devMessage = (line) => {
  const payload = JSON.parse(line);
  // A full reload is a new realm: the host runs this script again in it.
  if (payload.type === "full-reload") return native.devReload();
  if (payload.type === "error") {
    const { message, id, frame } = payload.err ?? {};
    console.error(`[vite] ${message ?? "error"}${id ? `\n  in ${id}` : ""}${frame ? `\n${frame}` : ""}`);
    return;
  }
  handlers?.onMessage(payload);
};

const runner = new ModuleRunner(
  {
    transport: {
      connect(given) {
        handlers = given;
      },
      send(data) {
        native.devSend(JSON.stringify(data));
      },
    },
    hmr: true,
    sourcemapInterceptor: false,
  },
  new ESModulesEvaluator(),
);

native.devStart = async (modules) => {
  try {
    for (const module of modules) await runner.import(module);
  } catch (error) {
    console.error(`Uncaught ${error?.stack ?? error}`);
  }
};
