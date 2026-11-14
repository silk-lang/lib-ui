// A stand-in for the native __ui functions of a ui-js host: it records the calls and keeps
// enough of the tree to answer questions in tests.
export function installMock() {
  const calls = [];
  const record = (name) => (...args) => {
    calls.push([name, ...args]);
  };
  const native = {};
  for (const name of [
    "create", "append", "insertBefore", "root", "setText", "listen", "style", "clearStyle",
    "attribute", "focus", "remove", "destroy", "scrollTo", "select", "fontFamily", "open",
  ]) {
    native[name] = record(name);
  }
  native.markdown = (text, flags) => {
    calls.push(["markdown", text, flags]);
    return '{"type":"root","children":[]}';
  };
  globalThis.__ui = native;
  return {
    calls,
    native,
    take() {
      return calls.splice(0, calls.length);
    },
    /** The last text set on node `id`. */
    textOf(id) {
      for (let i = calls.length - 1; i >= 0; i--) if (calls[i][0] === "setText" && calls[i][1] === id) return calls[i][2];
      return undefined;
    },
    click(id, x = 0, y = 0) {
      return native.dispatch(2, id, x, y, 0, 0, 1, undefined, undefined);
    },
    input(id, value) {
      return native.dispatch(11, id, value.length, value.length, 0, 0, 0, value, "insertText");
    },
  };
}
