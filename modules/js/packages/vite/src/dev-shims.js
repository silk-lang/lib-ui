// What Vite's module runner touches that a ui-js realm does not have. Source map
// interception is off, so the decoder is never asked for text.
globalThis.TextDecoder ??= class TextDecoder {
  decode() {
    return "";
  }
};

// The runner builds file URLs for import.meta: this covers `new URL("file://…").href`.
globalThis.URL ??= class URL {
  constructor(text) {
    this.href = encodeURI(String(text));
  }
  toString() {
    return this.href;
  }
};
