#!/usr/bin/env node
// Size, memory and startup of the same React app (app/Counter.jsx) on ui-js, Electron and
// Tauri, with a native tree window and Node as baselines. Linux and X11 only: the apps run
// under Xvfb, and xdotool sends the clicks. See README.md for the method and what each
// number means.
//
//   node run.mjs [--runs N] [--cold-runs N] [--only name,name] [--json out.json] [--markdown out.md]
//
// Build the targets first (README.md). A target whose files are missing is skipped.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const triple = "x86_64-unknown-linux-gnu";

const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}
const RUNS = Number(option("--runs", "5"));
const COLD_RUNS = Number(option("--cold-runs", "5"));
const ONLY = option("--only", "")?.split(",").filter(Boolean) ?? [];
const JSON_OUT = option("--json", "");
const MD_OUT = option("--markdown", "");
const CLICKS = 10;
const SETTLE_MS = 1500;
const IDLE_MS = 5000;
const TIMEOUT_MS = 30000;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const median = (values) => {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// ---------------------------------------------------------------- targets

const silkBuild = (profile, name) => join(repo, "build/llvm", triple, profile, name);
const electronDir = join(here, "electron/node_modules/electron/dist");
const tauriBinary = join(here, "tauri/target/release/bench-counter-tauri");
const silkBundle = join(here, "dist/silk/app.js");
const webDist = join(here, "dist/web");

/** Everything a target ships: [label, path] (a directory counts with all its files). */
const targets = [
  {
    name: "ui-js",
    label: "ui-js (SilkJS + React)",
    command: silkBuild("production", "ui-js-demo"),
    args: [silkBundle],
    cwd: repo,
    env: { SILK_UI_TRACE_FRAMES: "1" },
    gpuCache: true,
    title: "Silk UI",
    ships: [["binary", silkBuild("production", "ui-js-demo")], ["bundle", silkBundle], ["@silk/ui", join(repo, "modules/js/packages/ui/src/index.js")]],
    debugBinary: silkBuild("debug", "ui-js-demo"),
    interactive: true,
  },
  {
    name: "electron",
    label: "Electron + React DOM",
    command: join(electronDir, "electron"),
    // Root has no user namespace sandbox in a container; a desktop user keeps it.
    args: process.getuid?.() === 0 ? ["--no-sandbox", join(here, "electron")] : [join(here, "electron")],
    cwd: here,
    env: { NODE_OPTIONS: "" },
    title: "bench-counter",
    ships: [["electron", electronDir], ["app", join(here, "electron/main.cjs")], ["web", webDist]],
    interactive: true,
  },
  {
    name: "tauri",
    label: "Tauri + React DOM",
    command: tauriBinary,
    args: [],
    cwd: here,
    env: {},
    title: "bench-counter",
    // The web files are compiled into the binary. WebKitGTK is a system library.
    ships: [["binary", tauriBinary]],
    system: ["libwebkit2gtk-4.1.so.0", "libjavascriptcoregtk-4.1.so.0"],
    interactive: true,
  },
  {
    name: "ui-js-headless",
    label: "ui-js without a window",
    command: silkBuild("release", "ui-js-bench-headless"),
    args: [silkBundle],
    cwd: repo,
    env: {},
    title: null,
    ships: [["binary", silkBuild("release", "ui-js-bench-headless")], ["bundle", silkBundle]],
    // It clicks itself (bench/headless): the same lines, no window, no GPU.
    scripted: true,
  },
  {
    name: "tree-window",
    label: "Native tree counter (no JS)",
    command: silkBuild("release", "tree-window"),
    args: [],
    cwd: repo,
    env: { SILK_UI_TRACE_FRAMES: "1" },
    gpuCache: true,
    title: "Tree counter",
    // No JavaScript: the first frame is the first one presented.
    firstFrame: /^silk-ui: frame 1 presented/,
    ships: [["binary", silkBuild("release", "tree-window")]],
    debugBinary: silkBuild("debug", "tree-window"),
    interactive: false,
  },
  {
    name: "node",
    label: "Node, empty script",
    command: process.execPath,
    args: ["-e", "console.log('bench: first frame'); setInterval(() => {}, 1000)"],
    cwd: here,
    env: { NODE_OPTIONS: "" },
    title: null,
    ships: [["binary", process.execPath]],
    interactive: false,
  },
];

// ---------------------------------------------------------------- files

function sizeOf(path) {
  if (!existsSync(path)) return null;
  const info = lstatSync(path);
  if (info.isSymbolicLink()) return 0;
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of readdirSync(path)) total += sizeOf(join(path, entry)) ?? 0;
  return total;
}

function filesOf(path, out = []) {
  const info = lstatSync(path);
  if (info.isDirectory()) for (const entry of readdirSync(path)) filesOf(join(path, entry), out);
  else if (info.isFile()) out.push(path);
  return out;
}

/** Size of the shipped files as one gzip stream (what a download would roughly be). */
function gzipSizeOf(paths) {
  let total = 0;
  for (const path of paths) {
    if (!existsSync(path)) continue;
    for (const file of filesOf(path)) total += gzipSync(readFileSync(file), { level: 6 }).length;
  }
  return total;
}

function strippedSizeOf(binary) {
  const copy = join("/tmp", `bench-strip-${process.pid}`);
  const r = spawnSync("strip", ["-o", copy, binary]);
  if (r.status !== 0) return null;
  const size = statSync(copy).size;
  spawnSync("rm", ["-f", copy]);
  return size;
}

function systemLibrarySize(names) {
  let total = 0;
  for (const name of names) {
    const r = spawnSync("sh", ["-c", `ldconfig -p | grep -m1 '${name}' | sed 's/.*=> //'`], { encoding: "utf8" });
    const path = r.stdout.trim();
    if (path) total += statSync(path).size;
  }
  return total;
}

/**
 * Drops the page cache for a cold start: all of it when this process may (root), so system
 * libraries and drivers are read from disk too, as after a reboot; otherwise the files the
 * target ships. Mesa's shader cache stays on disk either way, as on a second launch.
 */
function evict(target) {
  spawnSync("sync");
  try {
    writeFileSync("/proc/sys/vm/drop_caches", "3\n");
    return "system";
  } catch {}
  for (const [, path] of target.ships) {
    if (!existsSync(path)) continue;
    for (const file of filesOf(path)) spawnSync("dd", [`if=${file}`, "iflag=nocache", "count=0", "status=none"]);
  }
  return "app files";
}

// ---------------------------------------------------------------- processes

function children() {
  const map = new Map();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      if (!map.has(ppid)) map.set(ppid, []);
      map.get(ppid).push(Number(entry));
    } catch {}
  }
  return map;
}

function tree(pid) {
  const map = children();
  const out = [];
  const walk = (p) => {
    out.push(p);
    for (const c of map.get(p) ?? []) walk(c);
  };
  walk(pid);
  return out;
}

function statusField(text, name) {
  const m = text.match(new RegExp(`^${name}:\\s+(\\d+) kB`, "m"));
  return m ? Number(m[1]) * 1024 : 0;
}

/** RSS, PSS and peak RSS summed over the process and its descendants. */
function memory(pid) {
  let rss = 0, pss = 0, peak = 0, count = 0;
  for (const p of tree(pid)) {
    try {
      const status = readFileSync(`/proc/${p}/status`, "utf8");
      rss += statusField(status, "VmRSS");
      peak += statusField(status, "VmHWM");
      const rollup = readFileSync(`/proc/${p}/smaps_rollup`, "utf8");
      const m = rollup.match(/^Pss:\s+(\d+) kB/m);
      if (m) pss += Number(m[1]) * 1024;
      count++;
    } catch {}
  }
  return { rss, pss, peak, processes: count };
}

const TICK = 100; // USER_HZ on Linux
function cpuSeconds(pid) {
  let ticks = 0;
  for (const p of tree(pid)) {
    try {
      const stat = readFileSync(`/proc/${p}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      ticks += Number(fields[11]) + Number(fields[12]);
    } catch {}
  }
  return ticks / TICK;
}

/** Starts a target and collects its output lines with their arrival times. */
function launch(target, env) {
  const start = performance.now();
  const child = spawn(target.command, target.args, {
    cwd: target.cwd,
    env: { ...process.env, ...env, ...target.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const lines = [];
  const waiters = [];
  const feed = (stream) => {
    let rest = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const now = performance.now();
      rest += chunk;
      let i;
      while ((i = rest.indexOf("\n")) >= 0) {
        const text = rest.slice(0, i);
        rest = rest.slice(i + 1);
        const line = { text, time: now };
        lines.push(line);
        for (const w of [...waiters]) if (w.test(line)) w.done(line);
      }
    });
  };
  feed(child.stdout);
  feed(child.stderr);
  let exited = false;
  child.on("exit", () => {
    exited = true;
    for (const w of [...waiters]) w.done(null);
  });
  /** The first line matching `pattern` that arrived after `after` (ms, performance.now). */
  function wait(pattern, after = 0, timeout = TIMEOUT_MS) {
    const test = (line) => line.time >= after && pattern.test(line.text);
    const found = lines.find(test);
    if (found) return Promise.resolve(found);
    if (exited) return Promise.resolve(null);
    return new Promise((resolveLine) => {
      const w = {
        test,
        done: (line) => {
          clearTimeout(timer);
          waiters.splice(waiters.indexOf(w), 1);
          resolveLine(line);
        },
      };
      const timer = setTimeout(() => w.done(null), timeout);
      waiters.push(w);
    });
  }
  async function stop() {
    if (exited) return;
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
    for (let i = 0; i < 20 && !exited; i++) await sleep(100);
    if (!exited) try { process.kill(-child.pid, "SIGKILL"); } catch {}
    for (let i = 0; i < 20 && !exited; i++) await sleep(100);
  }
  return { child, start, lines, wait, stop };
}

function xdotool(...a) {
  return spawnSync("xdotool", a, { encoding: "utf8", env: process.env });
}

/** A persistent XTest client (xinput.py): `send("click")` resolves once the server has it. */
function pointer() {
  const child = spawn("python3", ["-I", join(here, "xinput.py")], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
  child.stdout.setEncoding("utf8");
  const pending = [];
  let rest = "";
  child.stdout.on("data", (chunk) => {
    rest += chunk;
    let i;
    while ((i = rest.indexOf("\n")) >= 0) {
      rest = rest.slice(i + 1);
      pending.shift()?.();
    }
  });
  return {
    send(command) {
      return new Promise((done) => {
        pending.push(done);
        child.stdin.write(command + "\n");
      });
    },
    close() {
      child.stdin.end();
    },
  };
}

/** Screen position of a point in a window. */
function screenPoint(id, x, y) {
  const r = xdotool("getwindowgeometry", "--shell", id);
  const get = (name) => Number((r.stdout.match(new RegExp(`^${name}=(-?\\d+)`, "m")) ?? [])[1] ?? 0);
  return [get("X") + x, get("Y") + y];
}

async function windowOf(title) {
  for (let i = 0; i < 50; i++) {
    const r = xdotool("search", "--onlyvisible", "--name", `^${title}$`);
    const id = r.stdout.trim().split("\n").filter(Boolean).pop();
    if (id) return id;
    await sleep(100);
  }
  return null;
}

// ---------------------------------------------------------------- one run

async function measure(target, cold, env = {}) {
  const result = { cold };
  if (cold) result.evicted = evict(target);
  const app = launch(target, env);
  const first = await app.wait(target.firstFrame ?? /^bench: first frame/);
  if (!first) {
    await app.stop();
    throw new Error(`${target.name} never reported its first frame:\n${app.lines.map((l) => l.text).join("\n")}`);
  }
  result.firstFrameJs = first.time - app.start;
  const presented = await app.wait(/^silk-ui: frame 1 presented/, 0, target.env.SILK_UI_TRACE_FRAMES ? TIMEOUT_MS : 1);
  if (presented) {
    result.firstFramePresented = presented.time - app.start;
    // Where the window host's startup goes (SILK_UI_TRACE_FRAMES lines).
    result.phases = {};
    for (const [key, pattern] of [["hostStarted", /^silk-ui: host started/], ["windowOpen", /^silk-ui: window open/], ["gpuReady", /^silk-ui: gpu ready/], ["firstSubmitted", /^silk-ui: frame 1 submitted/]]) {
      const line = app.lines.find((l) => pattern.test(l.text));
      if (line) result.phases[key] = line.time - app.start;
    }
  }

  await sleep(SETTLE_MS);
  result.idle = memory(app.child.pid);

  // Idle CPU, as a share of one core, with nothing happening in the app.
  const cpu0 = cpuSeconds(app.child.pid);
  await sleep(IDLE_MS);
  result.idleCpu = (cpuSeconds(app.child.pid) - cpu0) / (IDLE_MS / 1000);

  if (target.scripted) {
    // The app clicks itself and times each step in process (bench/headless).
    const took = (pattern) => app.lines.filter((l) => pattern.test(l.text)).map((l) => Number(l.text.match(/took ([\d.e+-]+) ms/)[1]));
    const last = await app.wait(new RegExp(`^bench: click ${CLICKS}$`), 0);
    if (!last) throw new Error(`${target.name}: the clicks were not reported`);
    result.afterClicks = memory(app.child.pid);
    const rows = await app.wait(/^bench: rows took/, 0);
    if (!rows) throw new Error(`${target.name}: the rows were not reported`);
    result.clickToFrameJs = median(took(/^bench: click took/));
    result.rowsToFrameJs = took(/^bench: rows took/)[0];
    result.firstFrameInProcess = took(/^bench: first frame took/)[0];
    const split = app.lines.find((l) => l.text.startsWith("bench: split"));
    if (split) {
      const [, js, apply, frame] = split.text.match(/js=([\d.e+-]+) apply=([\d.e+-]+) frame=([\d.e+-]+)/).map(Number);
      result.split = { js, apply, frame };
    }
    await sleep(SETTLE_MS);
    result.afterRows = memory(app.child.pid);
  } else if (target.interactive) {
    const id = await windowOf(target.title);
    if (!id) throw new Error(`${target.name}: no window named ${target.title}`);
    const input = pointer();
    await input.send(`move ${screenPoint(id, 110, 50).join(" ")}`);
    await sleep(300);
    const latencies = [];
    const presents = [];
    for (let k = 1; k <= CLICKS; k++) {
      const before = performance.now();
      await input.send("click");
      const line = await app.wait(new RegExp(`^bench: click ${k}$`), before);
      if (!line) throw new Error(`${target.name}: click ${k} was not reported`);
      latencies.push(line.time - before);
      const shown = target.env.SILK_UI_TRACE_FRAMES ? await app.wait(/^silk-ui: frame \d+ presented/, before, 1000) : null;
      if (shown) presents.push(shown.time - before);
      await sleep(150);
    }
    result.clickToFrameJs = median(latencies);
    if (presents.length) result.clickToPresent = median(presents);
    result.afterClicks = memory(app.child.pid);

    // 1,000 rows: React work, layout and text for a thousand nodes in one commit.
    await input.send(`move ${screenPoint(id, 290, 50).join(" ")}`);
    await sleep(300);
    const before = performance.now();
    await input.send("click");
    input.close();
    const rows = await app.wait(/^bench: rows 1000$/, before);
    if (!rows) throw new Error(`${target.name}: the rows were not reported`);
    result.rowsToFrameJs = rows.time - before;
    await sleep(SETTLE_MS);
    result.afterRows = memory(app.child.pid);
  }
  await app.stop();
  return result;
}

// ---------------------------------------------------------------- main

function startDisplay() {
  if (process.env.DISPLAY) return null;
  const display = ":97";
  const server = spawn("Xvfb", [display, "-screen", "0", "1280x800x24", "-nolisten", "tcp"], { stdio: "ignore" });
  process.env.DISPLAY = display;
  return server;
}

function sizes(target) {
  const out = {};
  const binary = target.ships[0][1];
  out.shipped = target.ships.reduce((sum, [, path]) => sum + (sizeOf(path) ?? 0), 0);
  out.gzip = gzipSizeOf(target.ships.map(([, path]) => path));
  if (statSync(binary).isFile()) {
    out.binary = statSync(binary).size;
    out.stripped = strippedSizeOf(binary);
  }
  if (target.debugBinary && existsSync(target.debugBinary)) out.debug = statSync(target.debugBinary).size;
  if (target.system) out.system = systemLibrarySize(target.system);
  if (target.name === "ui-js" || target.name === "electron") {
    const bundle = target.name === "ui-js" ? silkBundle : join(webDist, "assets");
    out.bundle = sizeOf(bundle);
    out.bundleGzip = gzipSizeOf([bundle]);
  }
  return out;
}

async function main() {
  const display = startDisplay();
  await sleep(1500);
  const report = { date: new Date().toISOString(), host: hostInfo(), runs: RUNS, coldRuns: COLD_RUNS, targets: [] };
  try {
    for (const target of targets) {
      if (ONLY.length && !ONLY.includes(target.name)) continue;
      if (!existsSync(target.command)) {
        console.error(`skipping ${target.name}: ${target.command} is not built`);
        continue;
      }
      console.error(`measuring ${target.name}`);
      // Cold runs first, each after dropping the page cache, then the warm ones.
      const cold = [];
      for (let i = 0; i < COLD_RUNS; i++) {
        cold.push(await measure(target, true));
        process.stderr.write("c");
      }
      // A first launch: cold, and the window host's GPU cache (translated shaders, pipelines)
      // empty. Mesa's own shader cache stays.
      const first = [];
      for (let i = 0; target.gpuCache && i < COLD_RUNS; i++) {
        const empty = mkdtempSync(join(tmpdir(), "silk-ui-gpu-"));
        first.push(await measure(target, true, { SILK_UI_GPU_CACHE: empty }));
        rmSync(empty, { recursive: true, force: true });
        process.stderr.write("f");
      }
      const warm = [];
      for (let i = 0; i < RUNS; i++) {
        warm.push(await measure(target, false));
        process.stderr.write(".");
      }
      process.stderr.write("\n");
      report.targets.push({ name: target.name, label: target.label, sizes: sizes(target), cold: { ...summarize(cold), evicted: cold[0]?.evicted, runs: cold.map((r) => r.firstFrameJs) }, first: first.length ? summarize(first) : null, warm: summarize(warm) });
    }
  } finally {
    display?.kill();
  }
  const markdown = table(report);
  console.log(markdown);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n");
  if (MD_OUT) writeFileSync(MD_OUT, markdown + "\n");
}

/** The median of each number over the warm runs. */
function summarize(runs) {
  const pick = (path) => median(runs.map((r) => path.split(".").reduce((v, k) => v?.[k], r)));
  const out = {};
  for (const key of ["firstFrameJs", "firstFramePresented", "firstFrameInProcess", "phases.hostStarted", "phases.windowOpen", "phases.gpuReady", "phases.firstSubmitted", "split.js", "split.apply", "split.frame", "idleCpu", "clickToFrameJs", "clickToPresent", "rowsToFrameJs"]) out[key] = pick(key);
  for (const phase of ["idle", "afterClicks", "afterRows"]) {
    if (runs[0][phase] == null) continue;
    out[phase] = {};
    for (const key of ["rss", "pss", "peak", "processes"]) out[phase][key] = pick(`${phase}.${key}`);
  }
  return out;
}

function hostInfo() {
  const cpu = (readFileSync("/proc/cpuinfo", "utf8").match(/^model name\s*:\s*(.*)$/m) ?? [])[1];
  const vulkan = spawnSync("sh", ["-c", "vulkaninfo --summary 2>/dev/null | grep -m1 deviceName"], { encoding: "utf8" }).stdout.trim();
  return { cpu, cores: readdirSync("/sys/devices/system/cpu").filter((d) => /^cpu\d+$/.test(d)).length, kernel: readFileSync("/proc/sys/kernel/osrelease", "utf8").trim(), vulkan: vulkan.replace(/.*=\s*/, "") || null };
}

const MB = (bytes) => (bytes == null ? "" : (bytes / 1e6).toFixed(1));
const MS = (ms) => (ms == null ? "" : ms < 10 ? ms.toFixed(1) : ms.toFixed(0));

function table(report) {
  const rows = report.targets;
  const head = (cells) => `| ${cells.join(" | ")} |\n|${cells.map(() => "---").join("|")}|`;
  const line = (cells) => `| ${cells.join(" | ")} |`;
  const evicted = rows[0]?.cold.evicted === "system" ? "the whole page cache dropped" : "the app's files dropped from the page cache";
  let out = `Measured ${report.date.slice(0, 16)}Z on ${report.host.cpu} (${report.host.cores} cores), ${report.runs} warm runs + ${report.coldRuns} cold (${evicted} before each), medians.\n\n`;
  out += "Size (MB)\n\n";
  out += head(["", "shipped", "gzip", "binary", "stripped", "debug binary", "JS bundle (gzip)", "system libs"]) + "\n";
  for (const t of rows) {
    const s = t.sizes;
    out += line([t.label, MB(s.shipped), MB(s.gzip), MB(s.binary), MB(s.stripped), MB(s.debug), s.bundle ? `${MB(s.bundle)} (${MB(s.bundleGzip)})` : "", MB(s.system)]) + "\n";
  }
  out += "\nStartup and input (ms)\n\n";
  out += head(["", "first launch first frame", "cold first frame", "warm first frame", "warm first frame presented", "click to frame", "click to presented", "1000 rows to frame"]) + "\n";
  for (const t of rows) {
    out += line([t.label, MS(t.first?.firstFrameJs), MS(t.cold.firstFrameJs), MS(t.warm.firstFrameJs), MS(t.warm.firstFramePresented), MS(t.warm.clickToFrameJs), MS(t.warm.clickToPresent), MS(t.warm.rowsToFrameJs)]) + "\n";
  }
  const traced = rows.filter((t) => t.warm["phases.windowOpen"] != null);
  if (traced.length) {
    out += "\nWhere a tree window's warm startup goes (ms since launch)\n\n";
    out += head(["", "window host started", "window open", "GPU device ready", "frame 1 submitted", "frame 1 presented"]) + "\n";
    for (const t of traced) {
      const w = t.warm;
      out += line([t.label, MS(w["phases.hostStarted"]), MS(w["phases.windowOpen"]), MS(w["phases.gpuReady"]), MS(w["phases.firstSubmitted"]), MS(w.firstFramePresented)]) + "\n";
    }
  }
  const split = rows.find((t) => t.warm["split.js"] != null);
  if (split) {
    const w = split.warm;
    out += `\n1000 rows without a window (ms, in process): JavaScript and React commit ${MS(w["split.js"])}, applying the mutations to the tree ${MS(w["split.apply"])}, style, layout and text ${MS(w["split.frame"])}.\n`;
  }
  out += "\nMemory (MB, all processes of the app) and idle CPU\n\n";
  out += head(["", "processes", "idle RSS", "idle PSS", "after clicks PSS", "after 1000 rows PSS", "peak RSS", "idle CPU %"]) + "\n";
  for (const t of rows) {
    const w = t.warm;
    const peak = w.afterRows?.peak ?? w.afterClicks?.peak ?? w.idle.peak;
    out += line([t.label, w.idle.processes, MB(w.idle.rss), MB(w.idle.pss), MB(w.afterClicks?.pss), MB(w.afterRows?.pss), MB(peak), (w.idleCpu * 100).toFixed(1)]) + "\n";
  }
  return out;
}

main().catch((error) => {
  console.error(error.stack ?? String(error));
  process.exit(1);
});
