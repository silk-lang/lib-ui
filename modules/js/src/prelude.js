// The web globals a ui-js realm starts with, on top of the engine's ECMAScript: timers,
// animation frames, a console, queueMicrotask, performance.now and reportError. The host
// evaluates this once, before any application code. Edit it, then run
// `silk task embed-assets` to regenerate generated_prelude.silk.
(function () {
  const native = globalThis.__ui;
  const timers = new Map();
  let nextTimer = 0;

  function start(callback, delay, repeat, args) {
    if (typeof callback !== "function") throw new TypeError("a timer needs a function");
    const id = ++nextTimer;
    delay = Math.max(0, Number(delay) || 0);
    timers.set(id, { callback, delay, repeat, args });
    native.timer(id, delay);
    return id;
  }

  globalThis.setTimeout = (callback, delay, ...args) => start(callback, delay, false, args);
  globalThis.setInterval = (callback, delay, ...args) => start(callback, delay, true, args);
  globalThis.clearTimeout = globalThis.clearInterval = (id) => {
    if (timers.delete(id)) native.cancelTimer(id);
  };

  // The host calls this when timer `id` is due.
  native.fire = function (id) {
    const timer = timers.get(id);
    if (!timer) return;
    if (timer.repeat) native.timer(id, timer.delay);
    else timers.delete(id);
    timer.callback(...timer.args);
  };

  let frames = new Map();
  let nextFrame = 0;

  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    native.requestFrame();
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };

  // The host calls this before a frame, with the time in milliseconds. Callbacks requested
  // while it runs wait for the next frame, as on the web.
  native.frame = function (time) {
    const due = frames;
    frames = new Map();
    let failure = null;
    for (const callback of due.values()) {
      try {
        callback(time);
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure) throw failure.error;
  };

  globalThis.queueMicrotask = (callback) => {
    if (typeof callback !== "function") throw new TypeError("queueMicrotask needs a function");
    Promise.resolve().then(callback);
  };

  globalThis.performance = { now: () => native.now() };

  function show(value, depth) {
    if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
    if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
    if (typeof value !== "object" || value === null) return String(value);
    if (value instanceof Error) return value.stack ? String(value) + "\n" + value.stack : String(value);
    if (depth > 2) return Array.isArray(value) ? "[Array]" : "[Object]";
    if (Array.isArray(value)) return "[" + value.map((item) => show(item, depth + 1)).join(", ") + "]";
    const parts = Object.keys(value).map((key) => key + ": " + show(value[key], depth + 1));
    return parts.length ? "{ " + parts.join(", ") + " }" : "{}";
  }

  const log = (level) => (...values) => native.log(level, values.map((value) => show(value, 0)).join(" "));
  globalThis.console = {
    debug: log(0),
    log: log(1),
    info: log(1),
    warn: log(2),
    error: log(3),
    trace: log(1),
    assert(condition, ...values) {
      if (!condition) native.log(3, "Assertion failed" + (values.length ? ": " + values.map((value) => show(value, 0)).join(" ") : ""));
    },
  };

  globalThis.reportError = (error) => native.log(3, "Uncaught " + show(error, 0));

  // As `window.open` in a browser, for an address outside the application: the host opens
  // it with the system's browser or mail program. Only http, https and mailto addresses go.
  globalThis.open = (url) => {
    const address = String(url ?? "");
    if (!/^(https?:\/\/|mailto:)/i.test(address)) throw new TypeError("open takes an http, https or mailto address, not '" + address + "'");
    native.open(address);
    return null;
  };
})();
