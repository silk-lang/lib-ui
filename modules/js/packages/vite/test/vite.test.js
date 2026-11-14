import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import silk from "../src/index.js";

const root = fileURLToPath(new URL("./fixture", import.meta.url));

async function bundle(mode, entry = "src/main.js") {
  const outDir = mkdtempSync(join(tmpdir(), "silk-vite-"));
  await build({
    root,
    mode,
    configFile: false,
    logLevel: "silent",
    plugins: [silk({ entry })],
    build: { outDir },
  });
  return outDir;
}

test("builds one ES module and stamps it", async () => {
  const outDir = await bundle("production");
  const code = readFileSync(join(outDir, "app.js"), "utf8");
  assert.match(code, /mode production/);
  assert.doesNotMatch(code, /from\s*["']@silk\/ui["']/, "the library is bundled");
  assert.match(readFileSync(join(outDir, "app.js.stamp"), "utf8"), /^\d+\n$/);
});

test("development mode defines NODE_ENV for development builds", async () => {
  const outDir = await bundle("development");
  assert.ok(existsSync(join(outDir, "app.js.stamp")));
  assert.match(readFileSync(join(outDir, "app.js"), "utf8"), /mode development/);
});

test("takes a package's portable build, not its browser or Node one", async () => {
  // A ui-js realm has neither a DOM nor Node APIs: `browser` builds reach for `document`.
  const outDir = await bundle("production", "src/conditional.js");
  assert.match(readFileSync(join(outDir, "app.js"), "utf8"), /portable build/);
});
