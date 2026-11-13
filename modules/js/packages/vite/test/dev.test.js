// The dev server against a stand-in host: a TCP client that runs the first script in a
// bare context with recording `__ui` functions, as a ui-js window does with the engine.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createServer } from "vite";
import silk from "../src/index.js";
import { frames } from "../src/dev.js";

const here = fileURLToPath(new URL(".", import.meta.url));

async function until(what, check) {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** Connects to `port` and runs what the server sends, as the window host does. */
function fakeHost(port) {
  const calls = [];
  const logs = [];
  const socket = net.connect(port, "127.0.0.1");
  const native = new Proxy(
    {
      devSend: (line) => socket.write(`${line}\n`),
      now: () => performance.now(),
    },
    {
      get(target, name) {
        if (name in target) return target[name];
        return (...args) => {
          calls.push([name, ...args]);
        };
      },
    },
  );
  const print = (...args) => logs.push(args.join(" "));
  const context = vm.createContext({
    __ui: native,
    console: { log: print, info: print, debug: print, warn: print, error: print },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    performance,
    process: undefined,
  });
  let pending = "";
  let message = "";
  socket.setEncoding("utf8");
  socket.on("data", (text) => {
    pending += text;
    let end;
    while ((end = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      message += line.slice(2);
      if (line[1] === "+") continue;
      const whole = message;
      message = "";
      if (line[0] === "b") vm.runInContext(`(0, eval)(${whole})`, context);
      else native.devMessage(whole);
    }
  });
  const texts = () => calls.filter((call) => call[0] === "setText").map((call) => call[2]);
  return { calls, logs, texts, close: () => socket.destroy() };
}

test("long messages are split at character boundaries", () => {
  const text = "é".repeat(200 * 1024);
  const lines = frames("m", text);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("m+") && lines[1].startsWith("m."));
  assert.equal(lines.map((line) => line.slice(2, -1)).join(""), text);
});

test("the dev server runs the application in a host and replaces an edited component", async () => {
  // Inside the package, so the fixture's imports resolve from the workspace.
  const root = mkdtempSync(join(here, ".dev-"));
  cpSync(join(here, "dev-fixture"), root, { recursive: true });
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    cacheDir: join(root, ".vite"),
    server: { middlewareMode: true, ws: false },
    plugins: [silk({ port: 0 })],
  });
  let host;
  try {
    const listener = server.config.plugins.find((plugin) => plugin.name === "silk:dev").api.listener();
    host = fakeHost(listener.address().port);

    // The effect ran after the first render: the state is 1.
    await until("the first render", () => host.texts().includes("n=1 A"));
    assert.ok(host.calls.some((call) => call[0] === "root"), "the application mounted");

    // An edited component is replaced where it is, and keeps its state.
    const label = join(root, "src/Label.jsx");
    writeFileSync(label, readFileSync(label, "utf8").replace(' A"', ' B"'));
    await until("the hot update", () => host.texts().includes("n=1 B"));
    assert.ok(!host.texts().includes("n=0 B"), "the component was not mounted again");
    assert.ok(!host.calls.some((call) => call[0] === "devReload"), "no full reload for a component");

    // The entry has no component exports: an edit asks the host for a new realm.
    const main = join(root, "src/main.jsx");
    writeFileSync(main, `${readFileSync(main, "utf8")}\nconsole.log("edited");\n`);
    await until("the full reload", () => host.calls.some((call) => call[0] === "devReload"));
  } finally {
    host?.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
