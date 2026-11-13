import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import silk from "../src/index.js";
import { ownerOf } from "../src/apis.js";

const root = fileURLToPath(new URL("./api-fixture", import.meta.url));

async function run(options) {
  const warnings = [];
  const logger = {
    info() {},
    warn: (message) => warnings.push(message),
    warnOnce: (message) => warnings.push(message),
    error: (message) => warnings.push(message),
    clearScreen() {},
    hasErrorLogged: () => false,
    hasWarned: false,
  };
  await build({
    root,
    configFile: false,
    customLogger: logger,
    plugins: [silk({ entry: "src/main.js", ...options })],
    build: { outDir: mkdtempSync(join(tmpdir(), "silk-apis-")) },
  });
  return warnings.join("\n");
}

test("the build reports the missing APIs and who uses them", async () => {
  const text = await run({});
  assert.match(text, /fetch \(network\): src\/library\.js/);
  assert.match(text, /AbortController \(events\): src\/library\.js/);
  assert.match(text, /node:fs \(node\): src\/main\.js/);
  assert.doesNotMatch(text, /localStorage/, "a typeof test is not a use");
  assert.doesNotMatch(text, /Blob/, "a local of that name is not the global");
  assert.doesNotMatch(text, /process/, "process.env is replaced by the build");
});

test("allow silences a name, off silences the report, error fails the build", async () => {
  assert.doesNotMatch(await run({ allow: ["fetch"] }), /fetch \(network\)/);
  assert.doesNotMatch(await run({ apis: "off" }), /ui-js runtime/);
  await assert.rejects(run({ apis: "error" }), /fetch \(network\)/);
});

test("a module belongs to its package, or to the project by path", () => {
  assert.equal(ownerOf("/app/node_modules/@scope/pkg/dist/index.js", "/app"), "@scope/pkg");
  assert.equal(ownerOf("/app/node_modules/a/node_modules/b/index.js?v=1", "/app"), "b");
  assert.equal(ownerOf("/app/src/main.js", "/app"), "src/main.js");
});
