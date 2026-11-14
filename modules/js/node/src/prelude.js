// What a ui-js realm on the SilkJS runtime adds to Node's globals: animation frames,
// `window.open`, the `@silk/ui` modules the host defines, and uncaught exceptions printed
// as a browser console prints them, with the window left running.
(() => {
  const native = globalThis.__ui;

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

  // As `window.open` in a browser, for an address outside the application: the host opens
  // it with the system's browser or mail program. Only http, https and mailto addresses go.
  globalThis.open = (url) => {
    const address = String(url ?? "");
    if (!/^(https?:\/\/|mailto:)/i.test(address)) throw new TypeError("open takes an http, https or mailto address, not '" + address + "'");
    native.open(address);
    return null;
  };

  // A window stays open after an exception nothing caught, as a browser tab does.
  const uncaught = (error) => console.error("Uncaught", error);
  native.report = uncaught;
  process.on("uncaughtException", uncaught);
  process.on("unhandledRejection", (reason) => console.error("Uncaught (in promise)", reason));
  globalThis.reportError ??= uncaught;

  // Modules the host defines (`@silk/ui`), importable by name from any module.
  const modules = new Map();
  native.defineModule = (name, source) => {
    modules.set(name, source);
  };
  const scheme = "silk-module:";
  process.getBuiltinModule("node:module").registerHooks({
    resolve(specifier, context, next) {
      if (modules.has(specifier)) return { url: scheme + specifier, format: "module", shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith(scheme)) return { format: "module", source: modules.get(url.slice(scheme.length)), shortCircuit: true };
      return next(url, context);
    },
  });
})();
