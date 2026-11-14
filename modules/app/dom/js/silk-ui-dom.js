// The browser side of ui-app-dom: applies the mutation batches a program sends to real DOM
// nodes, and sends the events the document hears back as records. The byte layouts are the
// ones in `src/wire.silk`; the call codes are the ones in `src/page.silk`.

const CALL_START = 0;
const CALL_SCRATCH = 1;
const CALL_EVENT = 2;
const CALL_TICK = 3;
const CALL_RESIZE = 4;
const CALL_DEADLINE = 5;
const CALL_FRAMES = 6;
const CALL_LOCATION = 7;
const CALL_POST = 8;

const KIND_TEXT = 1;
const KIND_IMAGE = 2;
const KIND_ICON = 3;
const KIND_INPUT = 4;
const KIND_CANVAS = 5;

const EVENT = {
  pointerDown: 0,
  pointerUp: 1,
  click: 2,
  pointerMove: 3,
  pointerEnter: 4,
  pointerLeave: 5,
  wheel: 6,
  keyDown: 7,
  keyUp: 8,
  focus: 9,
  blur: 10,
  input: 11,
  scroll: 12,
  layout: 13,
  pointerCancel: 14,
  gotPointerCapture: 15,
  lostPointerCapture: 16,
  load: 17,
  error: 18,
};

// The listener flag of event kind `k` is `1 << k`.
const PREVENT_FOCUS = 1;
const PREVENT_SCROLL = 2;
const PREVENT_KEYS = 4;

// Later sheets win: a pressed node shows its active look over its hover look.
const STATES = [null, ":hover", ":active", ":focus", ":focus-visible"];
const STATE_ORDER = [1, 3, 4, 2];

// The same rules as `RESET` in `src/html.silk`, which a server render carries. `:where` gives
// them no specificity, so the page's own stylesheets win. A pseudo-element rule that matches
// every element makes the browser style that pseudo-element for each one, which costs about a
// third more style and layout time on a large table: `::selection` only matches the nodes that
// set a selection color (their descendants inherit it), `::placeholder` only inputs.
const RESET = `
:where([data-silk]) { outline: none; border-width: 0; -webkit-tap-highlight-color: transparent; }
:where([data-silk][role="button"]) { user-select: none; -webkit-user-select: none; }
:where(a[data-silk]) { display: block; color: inherit; text-decoration: none; }
:where(input[data-silk]), :where(textarea[data-silk]) {
  font: inherit; color: inherit; background: transparent; border: 0 solid; margin: 0;
  padding: 0; min-width: 0; resize: none; appearance: none; border-radius: 0;
}
:where([data-silk-icon]) {
  display: inline-block; flex: none; width: 1em; height: 1em; background-color: currentColor;
  -webkit-mask: var(--silk-icon) center / contain no-repeat;
  mask: var(--silk-icon) center / contain no-repeat;
}
:where([style*="--silk-selection-color"])::selection { background: var(--silk-selection-color, highlight); }
:where(input[data-silk], textarea[data-silk])::placeholder { color: var(--silk-placeholder-color, gray); opacity: 1; }
`;

const FOCUSABLE =
  '[tabindex]:not([tabindex="-1"]), input:not([tabindex="-1"]), textarea:not([tabindex="-1"]), a[href]:not([tabindex="-1"])';

// A map from node ids to values, in an array: the ids a program hands out are small and dense.
class IdTable {
  // `miss(id)` is asked for an id with no value: it may give it one (see `Page.fill`). A
  // `null` holds the place of a value that waits for that, so the array stays dense.
  constructor(miss) {
    this.values = [];
    this.miss = miss;
  }
  get(id) {
    const value = this.values[id];
    if (value != null) return value;
    this.miss(id);
    return this.values[id] ?? undefined;
  }
  set(id, value) {
    this.values[id] = value;
  }
  delete(id) {
    this.values[id] = undefined;
  }
  *[Symbol.iterator]() {
    const values = this.values;
    for (let id = 0; id < values.length; id++) if (values[id] != null) yield [id, values[id]];
  }
}

// `Mutation.DeclareFontFace` styles, by number.
const FACE_STYLES = ["normal", "italic", "oblique"];

const decoder = new TextDecoder();
const encoder = new TextEncoder();

class Reader {
  constructor(buffer, at, length) {
    this.view = new DataView(buffer, at, length);
    this.bytes = new Uint8Array(buffer, at, length);
    this.at = 0;
  }
  get done() {
    return this.at >= this.view.byteLength;
  }
  u8() {
    return this.view.getUint8(this.at++);
  }
  u32() {
    const value = this.view.getUint32(this.at, true);
    this.at += 4;
    return value;
  }
  f32() {
    const value = this.view.getFloat32(this.at, true);
    this.at += 4;
    return value;
  }
  text() {
    const length = this.u32();
    const bytes = this.bytes;
    const start = this.at;
    this.at += length;
    // Short ASCII text (labels, numbers, class names) without a decoder call.
    if (length <= 64) {
      let value = "";
      for (let i = start; i < start + length; i++) {
        const byte = bytes[i];
        if (byte > 127) return decoder.decode(bytes.subarray(start, start + length));
        value += String.fromCharCode(byte);
      }
      return value;
    }
    return decoder.decode(bytes.subarray(start, start + length));
  }
  // A copy: the program's memory moves.
  data() {
    const length = this.u32();
    const value = this.bytes.slice(this.at, this.at + length);
    this.at += length;
    return value;
  }
}

class Writer {
  constructor() {
    this.bytes = new Uint8Array(256);
    this.view = new DataView(this.bytes.buffer);
    this.at = 0;
  }
  room(size) {
    if (this.at + size <= this.bytes.length) return;
    const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.at + size));
    grown.set(this.bytes);
    this.bytes = grown;
    this.view = new DataView(grown.buffer);
  }
  u8(value) {
    this.room(1);
    this.view.setUint8(this.at++, value);
  }
  u32(value) {
    this.room(4);
    this.view.setUint32(this.at, value >>> 0, true);
    this.at += 4;
  }
  f32(value) {
    this.room(4);
    this.view.setFloat32(this.at, value, true);
    this.at += 4;
  }
  text(value) {
    const encoded = encoder.encode(value);
    this.u32(encoded.length);
    this.room(encoded.length);
    this.bytes.set(encoded, this.at);
    this.at += encoded.length;
  }
}

/**
 * Runs the program in `wasm` (a URL, a Response, bytes or a compiled module) inside `root`.
 *
 * `fonts` names the font families the program's `css.fontFamily(n)` numbers stand for, as CSS
 * `font-family` values: `{ 1: "Inter, sans-serif" }`. Images and icons are named by URL in the
 * program (`h.image("photos/a.png")`): the page loads them, relative ones from the app's root.
 * `loaders` adds schemes of the app's own, `{ db: async (url) => blob }`, each answering with a
 * Blob or an address. `base` is what comes before a link's path
 * in its address when the site is not at the root of its origin (`"/docs"`). `imports` adds
 * host modules the program imports besides `dom`, `math` and the standard library's `silk`.
 *
 * When `root` already holds the markup of a server render (`Html` in `src/html.silk`), the
 * program adopts its nodes instead of making new ones.
 */
export async function mount({ wasm, root, fonts = {}, loaders = {}, base = "", imports = {} }) {
  const module = await compile(wasm);
  const page = new Page(root, { fonts, loaders, base });
  const wanted = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    const group = (wanted[entry.module] ??= {});
    if (entry.module === "dom") {
      group[entry.name] = page.imports[entry.name];
    } else if (imports[entry.module]?.[entry.name]) {
      group[entry.name] = imports[entry.module][entry.name];
    } else if (entry.module === "math" && typeof Math[entry.name] === "function") {
      group[entry.name] = Math[entry.name];
    } else if (entry.module === "silk" && standardImports[entry.name]) {
      group[entry.name] = standardImports[entry.name](page);
    } else if (entry.kind === "function") {
      group[entry.name] = () => {
        throw new Error(`silk-ui: no host function ${entry.module}#${entry.name}`);
      };
    }
  }
  const instance = await WebAssembly.instantiate(module, wanted);
  page.start(instance.exports);
  return page;
}

// The host imports of the standard library's providers: `OsRandom` asks for `silk.random`,
// `OsSystemClock` and `OsMonotonicClock` for `silk.clock`. A program that uses them needs
// nothing from the page.
const standardImports = {
  random: (page) => (pointer, length) => {
    // `crypto.getRandomValues` fills at most 65536 bytes at a time.
    for (let at = 0; at < length; at += 65536) {
      crypto.getRandomValues(new Uint8Array(page.exports.memory.buffer, pointer + at, Math.min(65536, length - at)));
    }
  },
  clock: () => (monotonic) => (monotonic ? performance.now() : performance.timeOrigin + performance.now()),
};

async function compile(wasm) {
  if (wasm instanceof WebAssembly.Module) return wasm;
  if (typeof wasm === "string" || wasm instanceof URL) wasm = fetch(wasm);
  wasm = await wasm;
  if (wasm instanceof Response) {
    if (!wasm.ok) throw new Error(`silk-ui: ${wasm.url} answered ${wasm.status}`);
    wasm = await wasm.arrayBuffer();
  }
  return WebAssembly.compile(wasm);
}

class Page {
  constructor(root, { fonts, loaders = {}, base }) {
    this.root = root;
    this.loaders = Object.fromEntries(Object.entries(loaders).map(([scheme, load]) => [scheme.toLowerCase(), load]));
    this.base = base.replace(/\/$/, "");
    this.fonts = new Map(Object.entries(fonts).map(([id, names]) => [String(id), names]));
    // The address of each image and icon resource, by number.
    this.images = new Map();
    this.icons = new Map();
    // Font faces the program declared, by number, as promises of their `FontFace`.
    this.faces = new Map();
    // The stylesheets of font rules linked so far.
    this.stylesheets = new Set();
    // Addresses this page made for resources the program defined, to revoke.
    this.made = new Map();
    this.anchored = new Set();
    // By node id: ids are small and dense, so arrays beat maps here.
    const miss = (id) => this.fill(id);
    this.nodes = new IdTable(miss);
    this.meta = new IdTable(miss);

    // Nodes destroyed in this batch, still to take out of the document (see `removeDestroyed`).
    this.destroyed = [];
    // The subtrees the program made templates of (op 29), by number.
    this.templates = [];
    this.rootId = 0;
    this.busy = false;
    this.queued = [];
    this.timer = 0;
    this.frame = 0;
    this.hovered = [];
    this.skipMouseDown = false;
    this.failed = false;
    this.imports = {
      apply: (pointer, length) => this.apply(pointer, length),
      measure: (id, out) => this.measure(id, out),
      navigate: (pointer, length) => {
        const path = decoder.decode(new Uint8Array(this.exports.memory.buffer, pointer, length));
        history.pushState(null, "", this.address(path));
      },
    };
    this.adopt = this.found();

    const reset = document.createElement("style");
    reset.textContent = RESET;
    document.head.append(reset);
    this.sheets = STATES.map(() => null);
    for (const state of STATE_ORDER) {
      const style = document.createElement("style");
      document.head.append(style);
      this.sheets[state] = { sheet: style.sheet, rules: new Map() };
    }
    this.layout = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = this.idOf(entry.target);
        // The whole path, as for every other record: a handler under `h.map` is found along it.
        if (id) this.send(this.record(EVENT.layout, entry.target, this.pathTo(entry.target)));
      }
    });
    this.canvases = new ResizeObserver((entries) => {
      for (const entry of entries) this.paint(this.idOf(entry.target));
    });
  }

  // The nodes of a server render, by id: elements carry theirs in `data-silk` (`data-silk-html`
  // for plain HTML elements), and a text follows a comment that holds its id.
  found() {
    const found = new Map();
    const markers = [];
    const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === 1) {
        const id = node.dataset.silk ?? node.dataset.silkHtml;
        if (id) found.set(Number(id), node);
      } else if (/^\d+$/.test(node.data)) markers.push(node);
    }
    for (const marker of markers) {
      let text = marker.nextSibling;
      if (!text || text.nodeType !== 3) {
        text = document.createTextNode("");
        marker.after(text);
      }
      found.set(Number(marker.data), text);
      marker.remove();
    }
    return found;
  }

  // A link's address in this document: a path inside the app comes after the base.
  address(path) {
    return path.startsWith("/") ? this.base + path : path;
  }

  // Where the document is, as the program sees it: without the base.
  where() {
    let path = location.pathname;
    if (this.base && path.startsWith(this.base)) path = path.slice(this.base.length);
    path = path.replace(/index\.html$/, "");
    if (!path.startsWith("/")) path = `/${path}`;
    return path + location.search + location.hash;
  }

  /**
   * Posts `text` to the program's port `name` (`subs.port`): how the page answers a command
   * that started something slow, such as a request.
   */
  post(name, text = "") {
    const port = encoder.encode(name);
    const body = encoder.encode(String(text));
    const at = this.call(CALL_SCRATCH, port.length + body.length);
    const scratch = new Uint8Array(this.exports.memory.buffer, at, port.length + body.length);
    scratch.set(port);
    scratch.set(body, port.length);
    this.call(CALL_POST, port.length, body.length);
  }

  locate() {
    const bytes = encoder.encode(this.where());
    const at = this.call(CALL_SCRATCH, bytes.length);
    new Uint8Array(this.exports.memory.buffer, at, bytes.length).set(bytes);
    this.call(CALL_LOCATION, bytes.length);
  }

  start(exports) {
    this.exports = exports;
    this.token = exports.silk_ui_open();
    if (!this.token) throw new Error("silk-ui: the program did not start");
    this.listen();
    const size = this.size();
    this.locate();
    this.call(CALL_START, size.width, size.height, now());

    // What the first render did not adopt was not the program's.
    for (const node of this.adopt.values()) node.remove();
    this.adopt.clear();
    for (const [id, meta] of this.meta) {
      const node = this.nodes.get(id);
      if (meta.tag) continue;
      if (node.tagName === "A" && !meta.href) this.swap(id, "div");
      else if (node.tagName === "TEXTAREA" && !meta.multiline) this.swap(id, "input");
    }
  }

  size() {
    return { width: this.root.clientWidth, height: this.root.clientHeight || window.innerHeight };
  }

  // Calls into the program. The DOM work a call causes can raise events (a focus change, a
  // layout): they wait in `queued` until the call is over.
  call(op, a = 0, b = 0, c = 0) {
    if (this.failed) return 0;
    this.busy = true;
    let result;
    try {
      result = this.exports.silk_ui_call(this.token, op, a, b, c);
    } catch (error) {
      this.failed = true;
      throw error;
    } finally {
      this.busy = false;
    }
    if (result === -2) {
      this.failed = true;
      throw new Error(`silk-ui: call ${op} failed`);
    }
    if (op !== CALL_SCRATCH && op !== CALL_DEADLINE && op !== CALL_FRAMES) {
      while (this.queued.length && !this.busy) this.deliver(this.queued.shift());
      this.schedule();
    }
    return result;
  }

  schedule() {
    clearTimeout(this.timer);
    const deadline = this.exports.silk_ui_call(this.token, CALL_DEADLINE, 0, 0, 0);
    if (deadline >= 0) {
      const wait = Math.max(0, (deadline - now()) * 1000);
      this.timer = setTimeout(() => this.call(CALL_TICK, now(), 0), wait);
    }
    if (!this.frame && this.exports.silk_ui_call(this.token, CALL_FRAMES, 0, 0, 0) === 1) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.call(CALL_TICK, now(), 1);
      });
    }
  }

  // Sends a record. Returns whether a handler prevented the default action.
  send(record) {
    if (!record) return false;
    if (this.busy) {
      this.queued.push(record);
      return false;
    }
    return this.deliver(record);
  }

  deliver(record) {
    const length = record.at;
    const at = this.call(CALL_SCRATCH, length);
    new Uint8Array(this.exports.memory.buffer, at, length).set(record.bytes.subarray(0, length));
    return this.call(CALL_EVENT, length, now()) === 1;
  }

  // Mutations.

  apply(pointer, length) {
    const r = new Reader(this.exports.memory.buffer, pointer, length);
    while (!r.done) {
      const op = r.u8();
      if (op !== 4 && this.destroyed.length) this.removeDestroyed();
      switch (op) {
        case 1: {
          const id = r.u32();
          const kind = r.u8();
          // An element the program names (op 28) right after: made in place of the kind's own.
          let tag;
          if (!r.done && r.bytes[r.at] === 28 && r.view.getUint32(r.at + 1, true) === id) {
            r.at += 5;
            tag = r.text();
          }
          this.create(id, kind, tag);
          break;
        }
        case 2: {
          const parent = this.nodes.get(r.u32());
          // Its nodes get their ids by their place in it: before that place changes.
          if (parent.silkLazy !== undefined) this.register(parent);
          const child = this.nodes.get(r.u32());
          const before = r.u32() || 0;
          const next = before ? this.nodes.get(before) : null;
          // An adopted node is often where it belongs already.
          if (child.parentNode !== parent || child.nextSibling !== next) parent.insertBefore(child, next);
          break;
        }
        case 3:
          this.nodes.get(r.u32())?.remove();
          break;
        case 4:
          this.destroy(r.u32());
          break;
        case 5: {
          const id = r.u32();
          const state = r.u8();
          const style = this.styleOf(id, state, true);
          for (let count = r.u32(); count > 0; count--) this.declare(style, state, r.text());
          break;
        }
        case 6: {
          const id = r.u32();
          const state = r.u8();
          if (state === 0) {
            this.nodes.get(id)?.removeAttribute?.("style");
            this.refix(id);
          } else this.dropRule(id, state);
          break;
        }
        case 7:
          this.setText(this.nodes.get(r.u32()), r.text());
          break;
        case 8: {
          const node = this.nodes.get(r.u32());
          const anchor = r.u32();
          const focus = r.u32();
          node.setSelectionRange?.(Math.min(anchor, focus), Math.max(anchor, focus));
          break;
        }
        case 9:
          this.attribute(r.u32(), r);
          break;
        case 10: {
          const id = r.u32();
          const meta = this.meta.get(id);
          const before = meta.listeners;
          meta.listeners = r.u32();
          const bit = 1 << EVENT.layout;
          const node = this.nodes.get(id);
          if (node.nodeType === 1 && (before & bit) !== (meta.listeners & bit)) {
            meta.observed = (meta.listeners & bit) !== 0;
            if (meta.observed) this.layout.observe(node);
            else this.layout.unobserve(node);
          }
          break;
        }
        case 11: {
          // Only the first root is sent: the program answers any other itself.
          const root = r.u32();
          const id = r.u32();
          if (root !== 0) break;
          this.rootId = id;
          const node = this.nodes.get(this.rootId);
          if (node.parentNode === this.root) {
            for (const other of [...this.root.childNodes]) if (other !== node) other.remove();
          } else this.root.replaceChildren(node);
          break;
        }
        case 12:
          this.nodes.get(r.u32())?.focus?.({ preventScroll: false });
          break;
        case 13:
          if (this.root.contains(document.activeElement)) document.activeElement.blur();
          break;
        case 14:
          this.capture = this.nodes.get(r.u32());
          if (this.pointer !== undefined) {
            try {
              this.capture.setPointerCapture(this.pointer);
            } catch {}
          }
          break;
        case 15:
          if (this.capture && this.pointer !== undefined) {
            try {
              this.capture.releasePointerCapture(this.pointer);
            } catch {}
          }
          this.capture = undefined;
          break;
        case 16: {
          const node = this.nodes.get(r.u32());
          node.scrollTo(r.f32(), r.f32());
          break;
        }
        case 17:
          this.nodes.get(r.u32())?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
          break;
        case 18:
          this.fonts.set(String(r.u32()), r.text());
          break;
        case 19: {
          const id = r.u32();
          const pairs = [];
          for (const line of r.text().split(";")) {
            const colon = line.indexOf(":");
            if (colon > 0) pairs.push([line.slice(0, colon), line.slice(colon + 1).trim()]);
          }
          this.fix(id, "grid", pairs);
          break;
        }
        case 20: {
          const id = r.u32();
          this.meta.get(id).source = r.u32();
          this.show(id);
          break;
        }
        case 21: {
          const id = r.u32();
          const commands = [];
          for (let count = r.u32(); count > 0; count--) {
            const code = r.u8();
            const command = [code];
            for (let floats = CANVAS_FLOATS[code]; floats > 0; floats--) command.push(r.f32());
            commands.push(command);
          }
          this.meta.get(id).canvas = commands;
          this.paint(id);
          break;
        }
        case 22: {
          const id = r.u32();
          this.meta.get(id).anchor = {
            target: r.u32(),
            gap: r.f32(),
            preferredHeight: r.f32(),
            alignEnd: r.u8() === 1,
            matchWidth: r.u8() === 1,
          };
          this.anchored.add(id);
          break;
        }
        case 23: {
          const id = r.u32();
          this.anchored.delete(id);
          const meta = this.meta.get(id);
          if (meta) {
            meta.anchor = undefined;
            this.fix(id, "anchor", []);
          }
          break;
        }
        case 24:
          this.define(this.images, r.u32(), new Blob([r.data()]));
          break;
        case 25:
          this.define(this.icons, r.u32(), new Blob([r.data()], { type: "image/svg+xml" }));
          break;
        case 26: {
          const resource = r.u32();
          for (const key of [`image:${resource}`, `icon:${resource}`]) {
            if (this.made.has(key)) URL.revokeObjectURL(this.made.get(key));
            this.made.delete(key);
          }
          break;
        }
        case 28: {
          const id = r.u32();
          const tag = r.text();
          const meta = this.meta.get(id);
          meta.tag = tag || undefined;
          const next = this.swap(id, tag || TAGS[meta.kind][0].toLowerCase());
          // Plain HTML has no `data-silk` (see `create`); a state rule names it by either.
          if (!tag) next.setAttribute("data-silk", id);
          else if (!next.hasAttribute("data-silk-html")) next.removeAttribute("data-silk");
          break;
        }
        case 29: {
          // The subtree of a node becomes a template: later ones like it are copies of it.
          const template = r.u32();
          const top = r.u32();
          const metas = [];
          for (let count = r.u32(), id = top; count > 0; count--, id++) {
            const meta = this.meta.get(id);
            metas.push({ kind: meta.kind, listeners: meta.listeners, tag: meta.tag });
          }
          const node = this.nodes.get(top).cloneNode(true);
          // Where each text node is: the child to take at each level down from the top. And
          // no copy shows as the node the template was made from: a state rule names a node
          // by its `data-silk`.
          const paths = [];
          const walk = (at, path) => {
            if (at.nodeType === 3) paths[paths.length] = path;
            else {
              paths[paths.length] = undefined;
              if (at.hasAttribute("data-silk")) at.setAttribute("data-silk", "");
            }
            let index = 0;
            for (let child = at.firstChild; child; child = child.nextSibling) walk(child, [...path, index++]);
          };
          walk(node, []);
          this.templates[template] = { node, metas, paths };
          break;
        }
        case 30:
          this.clone(r);
          break;
        case 31:
          this.load(this.images, r.u32(), r.text());
          break;
        case 32:
          this.load(this.icons, r.u32(), r.text());
          break;
        case 33: {
          const face = r.u32();
          const family = r.text();
          const url = r.text();
          const weight = [r.f32(), r.f32()];
          const width = [r.f32(), r.f32()];
          const style = FACE_STYLES[r.u8()] ?? "normal";
          const ranges = [];
          for (let count = r.u32(); count >= 2; count -= 2) ranges.push([r.u32(), r.u32()]);
          this.declareFace(face, family, url, weight, width, style, ranges);
          break;
        }
        case 34: {
          const face = r.u32();
          r.text();
          this.faces.get(face)?.then((found) => found?.load()).catch(() => {});
          break;
        }
        case 35:
          this.linkFonts(r.text());
          break;
        case 27: {
          // The first root closes: the mounted element shows nothing.
          if (r.u32() !== 0) break;
          this.nodes.get(this.rootId)?.remove();
          this.rootId = 0;
          break;
        }
        default:
          throw new Error(`silk-ui: unknown mutation ${op}`);
      }
    }
    if (this.destroyed.length) this.removeDestroyed();
    this.place();
  }

  // Inline properties the base look does not own (a cursor, a grid, a popup's place): set
  // as group `group` of node `id`, in place of the group's earlier ones.
  fix(id, group, pairs) {
    const node = this.nodes.get(id);
    const meta = this.meta.get(id);
    if (!node?.style || !meta) return;
    meta.fixed ??= new Map();
    for (const [name] of meta.fixed.get(group) ?? []) node.style.removeProperty(name);
    pairs = pairs.filter(([, value]) => value !== "");
    if (pairs.length) meta.fixed.set(group, pairs);
    else meta.fixed.delete(group);
    for (const [name, value] of pairs) node.style.setProperty(name, value);
  }

  // Sets the fixed properties again, after the base look was cleared.
  refix(id) {
    const node = this.nodes.get(id);
    const fixed = this.meta.get(id)?.fixed;
    if (!node?.style || !fixed) return;
    for (const pairs of fixed.values()) {
      for (const [name, value] of pairs) node.style.setProperty(name, value);
    }
  }

  // Shows the resource an image or icon node names.
  show(id) {
    const node = this.nodes.get(id);
    const meta = this.meta.get(id);
    if (meta.kind === KIND_IMAGE) {
      const address = this.images.get(meta.source);
      if (address) node.src = address;
      else node.removeAttribute("src");
    } else if (meta.kind === KIND_ICON) {
      const address = this.icons.get(meta.source);
      this.fix(id, "icon", address ? [["--silk-icon", `url("${address}")`]] : []);
      // A mask image says nothing when it loads; a probe tells the icon's listeners.
      if (address && meta.listeners & ((1 << EVENT.load) | (1 << EVENT.error))) {
        const probe = new Image();
        probe.onload = () => this.nodes.get(id) === node && this.direct(EVENT.load, node);
        probe.onerror = () => this.nodes.get(id) === node && this.direct(EVENT.error, node);
        probe.src = address;
      }
    }
  }

  // Loads a resource the program named by URL. A scheme the app gave a loader for goes to that
  // loader, which answers with a Blob or an address; any other URL is the browser's to load.
  // A relative URL is one of the app's own files, so it resolves against the app's root (the
  // origin and `base`), not against the current route.
  // An address the page can fetch for `url`, as `load` resolves image and icon URLs: a
  // scheme with a loader goes through it (to a Blob or an address), any other scheme is
  // fetched as it is, and a relative URL is the app's own file.
  async resolve(url) {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
    const loader = scheme ? this.loaders[scheme] : undefined;
    if (loader) return await loader(url);
    return scheme ? url : new URL(url, `${location.origin}${this.base}/`).href;
  }

  // An `@font-face` rule: the browser fetches the file when text first needs the face, and
  // swaps it in, as for a page's own rule. A face from a loader's Blob loads at once.
  declareFace(face, family, url, weight, width, style, ranges) {
    const range = (n) => n.toString(16).toUpperCase();
    const descriptors = {
      weight: weight[0] === weight[1] ? `${weight[0]}` : `${weight[0]} ${weight[1]}`,
      stretch: width[0] === width[1] ? `${width[0]}%` : `${width[0]}% ${width[1]}%`,
      style,
      display: "swap",
    };
    if (ranges.length > 0) {
      descriptors.unicodeRange = ranges.map(([first, last]) => `U+${range(first)}-${range(last)}`).join(", ");
    }
    const made = this.resolve(url).then(
      async (found) => {
        const source = found instanceof Blob ? await found.arrayBuffer() : `url(${JSON.stringify(String(found))})`;
        const font = new FontFace(family, source, descriptors);
        document.fonts.add(font);
        return font;
      },
      (error) => {
        console.error(`silk-ui: could not load font ${url}`, error);
        return undefined;
      },
    );
    this.faces.set(face, made);
  }

  // A stylesheet of `@font-face` rules (Google Fonts and the like), linked once.
  linkFonts(url) {
    this.resolve(url).then(
      (found) => {
        const href = found instanceof Blob ? URL.createObjectURL(found) : String(found);
        if (this.stylesheets.has(href)) return;
        this.stylesheets.add(href);
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        document.head.append(link);
      },
      (error) => console.error(`silk-ui: could not load fonts ${url}`, error),
    );
  }

  load(map, resource, url) {
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
    const loader = scheme ? this.loaders[scheme] : undefined;
    if (loader) {
      Promise.resolve(loader(url)).then(
        (found) => (found instanceof Blob ? this.define(map, resource, found) : this.set(map, resource, String(found))),
        (error) => {
          console.error(`silk-ui: could not load ${url}`, error);
          const kind = map === this.images ? KIND_IMAGE : KIND_ICON;
          for (const [id, meta] of this.meta) {
            if (meta.source === resource && meta.kind === kind) this.direct(EVENT.error, this.nodes.get(id));
          }
        },
      );
      return;
    }
    this.set(map, resource, scheme ? url : new URL(url, `${location.origin}${this.base}/`).href);
  }

  set(map, resource, address) {
    const key = `${map === this.images ? "image" : "icon"}:${resource}`;
    if (this.made.has(key)) URL.revokeObjectURL(this.made.get(key));
    this.made.delete(key);
    map.set(resource, address);
    for (const [id, meta] of this.meta) if (meta.source === resource) this.show(id);
  }

  define(map, resource, blob) {
    const key = `${map === this.images ? "image" : "icon"}:${resource}`;
    if (this.made.has(key)) URL.revokeObjectURL(this.made.get(key));
    const address = URL.createObjectURL(blob);
    this.made.set(key, address);
    map.set(resource, address);
    for (const [id, meta] of this.meta) if (meta.source === resource) this.show(id);
  }

  // Draws a canvas node's commands, in CSS pixels on a bitmap as sharp as the display.
  paint(id) {
    const node = this.nodes.get(id);
    const commands = this.meta.get(id)?.canvas;
    if (!node || !commands || !node.getContext) return;
    const scale = window.devicePixelRatio || 1;
    const width = Math.round(node.clientWidth * scale);
    const height = Math.round(node.clientHeight * scale);
    if (node.width !== width) node.width = width;
    if (node.height !== height) node.height = height;
    const context = node.getContext("2d");
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, node.clientWidth, node.clientHeight);
    const color = (c, at) =>
      `rgba(${Math.round(c[at] * 255)}, ${Math.round(c[at + 1] * 255)}, ${Math.round(c[at + 2] * 255)}, ${c[at + 3]})`;
    let path = new Path2D();
    for (const c of commands) {
      switch (c[0]) {
        case 0: {
          const rect = new Path2D();
          if (c[5] > 0) rect.roundRect(c[1], c[2], c[3], c[4], c[5]);
          else rect.rect(c[1], c[2], c[3], c[4]);
          context.fillStyle = color(c, 6);
          context.fill(rect);
          break;
        }
        case 1:
          path.moveTo(c[1], c[2]);
          break;
        case 2:
          path.lineTo(c[1], c[2]);
          break;
        case 3:
          path.quadraticCurveTo(c[1], c[2], c[3], c[4]);
          break;
        case 4:
          path.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
          break;
        case 5:
          path.closePath();
          break;
        case 6:
          context.fillStyle = color(c, 1);
          context.fill(path);
          path = new Path2D();
          break;
        case 7:
          context.strokeStyle = color(c, 1);
          context.lineWidth = c[5];
          context.stroke(path);
          path = new Path2D();
          break;
      }
    }
  }

  // Puts every anchored popup by its target: below it, or above when there is more room
  // there, inside the viewport.
  place() {
    for (const id of this.anchored) {
      const node = this.nodes.get(id);
      const anchor = this.meta.get(id)?.anchor;
      const target = anchor && this.nodes.get(anchor.target);
      if (!node?.isConnected || !target?.isConnected) continue;
      const by = target.getBoundingClientRect();
      const first = [["position", "fixed"]];
      if (anchor.matchWidth) first.push(["min-width", `${by.width}px`]);
      this.fix(id, "anchor", [...first, ["left", "0px"], ["top", "0px"]]);
      const box = node.getBoundingClientRect();
      const below = window.innerHeight - by.bottom - anchor.gap;
      const above = by.top - anchor.gap;
      const needs = anchor.preferredHeight || box.height;
      const under = below >= needs || below >= above;
      let left = anchor.alignEnd ? by.right - box.width : by.left;
      left = Math.max(0, Math.min(left, window.innerWidth - box.width));
      const top = under ? by.bottom + anchor.gap : by.top - anchor.gap - box.height;
      this.fix(id, "anchor", [...first, ["left", `${left}px`], ["top", `${Math.max(0, top)}px`]]);
    }
  }

  create(id, kind, tag) {
    let node = this.adopt.get(id);
    if (node && (tag ? node.nodeName === tag.toUpperCase() : TAGS[kind].includes(node.nodeName))) {
      // A node of the server render: the program sets it up as it would a new one.
      this.adopt.delete(id);
      if (node.nodeType === 1) {
        for (const name of node.getAttributeNames()) node.removeAttribute(name);
      }
    } else if (kind === KIND_TEXT) node = document.createTextNode("");
    else node = document.createElement(tag || TAGS[kind][0].toLowerCase());
    // An element whose name the view chose is plain HTML: no `data-silk`, so the reset sheet
    // leaves it to the page's styles (and a large table skips an attribute per cell).
    if (node.nodeType === 1 && !tag) node.setAttribute("data-silk", id);
    node.silkId = id;
    if (kind === KIND_ICON) node.setAttribute("data-silk-icon", "");
    if (kind === KIND_CANVAS) this.canvases.observe(node);
    this.nodes.set(id, node);
    this.meta.set(id, { kind, listeners: 0, prevent: 0, tag });
  }

  // Makes a copy of a template (op 29). Its nodes have the ids from the one given on, in
  // document order, as the program handed them out; then come the texts that differ. Only the
  // top node goes in the tables now: most rows of a long list are never named again, so the
  // others wait until one of them is (`fill`, `reveal`).
  clone(r) {
    const template = this.templates[r.u32()];
    const top = r.u32();
    const root = template.node.cloneNode(true);
    const { kind, listeners, tag } = template.metas[0];
    root.silkId = top;
    root.silkLazy = template;
    const nodes = this.nodes.values;
    const all = this.meta.values;
    nodes[top] = root;
    all[top] = { kind, listeners, prevent: 0, tag };
    if (!tag) root.setAttribute("data-silk", top);
    // The places of the others, which `fill` finds the top node from.
    for (let id = top + 1, end = top + template.metas.length; id < end; id++) {
      nodes[id] = null;
      all[id] = null;
    }
    const paths = template.paths;
    for (let count = r.u32(); count > 0; count--) {
      const path = paths[r.u32()];
      let node = root;
      for (let level = 0; level < path.length; level++) {
        node = node.firstChild;
        for (let along = path[level]; along > 0; along--) node = node.nextSibling;
      }
      node.data = r.text();
    }
  }

  // Puts the nodes of copy `root` (see `clone`) in the tables.
  register(root) {
    const { metas } = root.silkLazy;
    root.silkLazy = undefined;
    const top = root.silkId;
    const nodes = this.nodes.values;
    const all = this.meta.values;
    let node = root;
    for (let k = 0; ; k++) {
      if (k > 0) {
        const id = top + k;
        const { kind, listeners, tag } = metas[k];
        node.silkId = id;
        nodes[id] = node;
        all[id] = { kind, listeners, prevent: 0, tag };
        if (!tag && node.nodeType === 1) node.setAttribute("data-silk", id);
      }
      // Document order, without recursion: down, then along, then up and along.
      let next = node.firstChild;
      if (!next) {
        while (node !== root && !node.nextSibling) node = node.parentNode;
        if (node === root) break;
        next = node.nextSibling;
      }
      node = next;
    }
  }

  // A table has nothing for `id`: it may be a node of a copy that waits (see `clone`).
  fill(id) {
    const nodes = this.nodes.values;
    if (nodes[id] !== null) return;
    // The top node of the copy is the nearest id before it that has its node.
    let top = id - 1;
    while (top > 0 && nodes[top] === null) top--;
    const root = nodes[top];
    const template = root?.silkLazy;
    if (template && id < top + template.metas.length) this.register(root);
  }

  // `node` has no id: when it is inside a copy that waits, its nodes get theirs.
  reveal(node) {
    for (let at = node.parentNode; at && at !== this.root; at = at.parentNode) {
      if (at.silkLazy !== undefined) {
        this.register(at);
        return;
      }
      if (at.silkId !== undefined) return;
    }
  }

  // Frees node `id` and its whole subtree. The subtree leaves the document with the other
  // nodes this batch destroys, in `removeDestroyed`.
  destroy(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    this.forget(node);
    this.destroyed.push(node);
  }

  forget(top) {
    const ruled = this.sheets.some((sheet) => sheet && sheet.rules.size);
    for (let node = top; node; ) {
      const id = node.silkId;
      if (id !== undefined) {
        const meta = this.meta.get(id);
        if (meta?.observed) this.layout.unobserve(node);
        if (meta?.kind === KIND_CANVAS) this.canvases.unobserve(node);
        if (ruled) for (const state of STATE_ORDER) this.dropRule(id, state);
        if (this.anchored.size) this.anchored.delete(id);
        if (this.nodes.get(id) === node) {
          this.nodes.delete(id);
          this.meta.delete(id);
        }
      }
      // Depth first, without recursion: down, then along, then up and along. The nodes inside
      // a copy that waits (see `clone`) were never named, so they hold nothing to forget.
      if (node.silkLazy === undefined && node.firstChild) {
        node = node.firstChild;
        continue;
      }
      while (node !== top && !node.nextSibling) node = node.parentNode;
      node = node === top ? null : node.nextSibling;
    }
  }

  // Takes the destroyed nodes out of the document. When they are all of a parent's children,
  // the parent is emptied in one step, as a clear of a long list needs.
  removeDestroyed() {
    const nodes = this.destroyed;
    this.destroyed = [];
    const parent = nodes[0].parentNode;
    if (parent && nodes.length > 1 && parent.childNodes.length === nodes.length && nodes.every((node) => node.parentNode === parent)) {
      parent.textContent = "";
      return;
    }
    for (const node of nodes) node.remove();
  }

  styleOf(id, state, make) {
    if (state === 0) return this.nodes.get(id).style;
    const { sheet, rules } = this.sheets[state];
    let rule = rules.get(id);
    if (!rule && make) {
      const node = this.nodes.get(id);
      let attribute = "data-silk";
      if (!node.hasAttribute(attribute)) {
        attribute = "data-silk-html";
        node.setAttribute(attribute, id);
      }
      const at = sheet.insertRule(`[${attribute}="${id}"]${STATES[state]} {}`, sheet.cssRules.length);
      rule = sheet.cssRules[at];
      rules.set(id, rule);
    }
    return rule?.style;
  }

  dropRule(id, state) {
    const { sheet, rules } = this.sheets[state];
    if (!rules.size) return;
    const rule = rules.get(id);
    if (!rule) return;
    rules.delete(id);
    const at = Array.prototype.indexOf.call(sheet.cssRules, rule);
    if (at >= 0) sheet.deleteRule(at);
  }

  // `line` is one declaration as CSS text: `name: value` and maybe ` !important`.
  declare(style, state, line) {
    if (!style) return;
    const colon = line.indexOf(":");
    let name = line.slice(0, colon);
    let value = line.slice(colon + 1).trim();
    let important = state !== 0;
    if (value.endsWith("!important")) {
      value = value.slice(0, -10).trim();
      important = true;
    }
    if (name === "font-family") value = this.fonts.get(value) ?? "inherit";
    else if (name.startsWith("-silk-")) name = `-${name}`;
    style.setProperty(name, value, important ? "important" : "");
  }

  setText(node, value) {
    if (node.nodeType === 3) node.data = value;
    else if ("value" in node) {
      if (node.value !== value) node.value = value;
    } else node.textContent = value;
  }

  attribute(id, r) {
    const node = this.nodes.get(id);
    const meta = this.meta.get(id);
    const code = r.u8();
    const set = (name, value) => {
      if (value === null || value === "") node.removeAttribute(name);
      else node.setAttribute(name, value);
    };
    switch (code) {
      case 0:
        set("aria-valuemin", r.f32());
        set("aria-valuemax", r.f32());
        set("aria-valuenow", r.f32());
        break;
      case 1:
        for (const name of ["aria-valuemin", "aria-valuemax", "aria-valuenow"]) set(name, null);
        break;
      case 2:
        set("role", r.text());
        break;
      case 3:
        set("aria-label", r.text());
        break;
      case 4:
        set("data-testid", r.text());
        break;
      case 5: {
        const mode = r.u8();
        if (mode === 0) set("tabindex", meta.kind === KIND_INPUT ? "-1" : null);
        else if (mode === 2) set("tabindex", "-1");
        else set("tabindex", String(r.u32()));
        break;
      }
      case 6:
        this.fix(id, "cursor", [["cursor", r.text()]]);
        break;
      case 7: {
        const on = r.u8() === 1;
        set("aria-disabled", on ? "true" : null);
        if ("disabled" in node) node.disabled = on;
        break;
      }
      case 8:
        meta.trap = r.u8() === 1;
        break;
      case 9:
        meta.multiline = r.u8() === 1;
        if (meta.multiline !== (node.tagName === "TEXTAREA")) this.swap(id, meta.multiline ? "textarea" : "input");
        break;
      case 10:
        node.readOnly = r.u8() === 1;
        break;
      case 11:
        set("placeholder", r.text());
        break;
      case 12:
        meta.checked = r.u8() === 1;
        set("aria-checked", meta.mixed ? "mixed" : meta.checked ? "true" : "false");
        break;
      case 13:
        set("aria-selected", r.u8() === 1 ? "true" : "false");
        break;
      case 14:
        set("aria-expanded", r.u8() === 1 ? "true" : "false");
        break;
      case 15:
        meta.prevent = r.u32();
        break;
      case 16: {
        // A box with an address is an `a`, so the document treats it as the link it is.
        meta.href = r.text();
        let link = node;
        if (meta.tag) link = node;
        else if (meta.href && node.tagName === "DIV") link = this.swap(id, "a");
        else if (!meta.href && node.tagName === "A") link = this.swap(id, "div");
        if (meta.href) link.setAttribute("href", this.address(meta.href));
        else link.removeAttribute("href");
        break;
      }
      case 17:
        this.fix(id, "transition", [["transition", r.text()]]);
        break;
      case 18: {
        const value = r.text();
        if (value) node.className = value;
        else node.removeAttribute("class");
        break;
      }
      case 19:
        set("id", r.text());
        break;
      case 20: {
        const name = r.text();
        set(name, r.text() || null);
        break;
      }
      case 21:
        meta.mixed = r.u8() === 1;
        if (meta.mixed) set("aria-checked", "mixed");
        else set("aria-checked", meta.checked === undefined ? null : meta.checked ? "true" : "false");
        break;
      default:
        throw new Error(`silk-ui: unknown attribute ${code}`);
    }
  }

  // Swaps the element of node `id` for a `tag` one, keeping what was set on it and in it.
  swap(id, tag) {
    const node = this.nodes.get(id);
    if (node.silkLazy !== undefined) this.register(node);
    const next = document.createElement(tag);
    for (const attribute of node.attributes) next.setAttribute(attribute.name, attribute.value);
    if ("value" in node) next.value = node.value;
    else next.append(...node.childNodes);
    if (this.meta.get(id).listeners & (1 << EVENT.layout)) {
      this.layout.unobserve(node);
      this.layout.observe(next);
    }
    node.replaceWith(next);
    next.silkId = id;
    this.nodes.set(id, next);
    return next;
  }

  measure(id, out) {
    const node = this.nodes.get(id);
    if (!node || node.nodeType !== 1 || !node.isConnected) return 0;
    const box = node.getBoundingClientRect();
    const origin = this.root.getBoundingClientRect();
    const view = new DataView(this.exports.memory.buffer, out, 19);
    view.setFloat32(0, box.left - origin.left, true);
    view.setFloat32(4, box.top - origin.top, true);
    view.setFloat32(8, box.width, true);
    view.setFloat32(12, box.height, true);
    view.setUint8(16, node.matches(":active") ? 1 : 0);
    view.setUint8(17, node.matches(":hover") ? 1 : 0);
    view.setUint8(18, node === document.activeElement ? 1 : 0);
    return 1;
  }

  // Events.

  idOf(node) {
    if (!node) return 0;
    if (node.silkId === undefined) this.reveal(node);
    return node.silkId ?? 0;
  }

  // The program's elements from the root down to the one that holds `node`.
  pathTo(node) {
    const path = [];
    if (node && node.silkId === undefined) this.reveal(node);
    for (let at = node; at && at !== this.root; at = at.parentNode) {
      if (at.nodeType === 1 && at.silkId !== undefined) path.push(at);
    }
    if (!path.length || this.idOf(path[path.length - 1]) !== this.rootId) return [];
    return path.reverse();
  }

  hears(path, kind) {
    const bit = 1 << kind;
    return path.some((node) => (this.meta.get(this.idOf(node))?.listeners ?? 0) & bit);
  }

  // Whether `path` is inside a link to a place in the app: the program follows a click on
  // it, and says so by preventing the document's own navigation.
  links(path) {
    return path.some((node) => this.meta.get(this.idOf(node))?.href?.startsWith("/"));
  }

  // Keeps Tab inside the innermost focus trap around `target`. Returns whether it moved focus.
  trap(target, backwards) {
    let within = null;
    for (let at = target; at && at !== this.root; at = at.parentNode) {
      if (this.meta.get(this.idOf(at))?.trap) {
        within = at;
        break;
      }
    }
    if (!within) return false;
    const stops = [...within.querySelectorAll(FOCUSABLE)].filter(
      (node) => !node.disabled && node.getClientRects().length,
    );
    if (!stops.length) return true;
    const at = stops.indexOf(document.activeElement);
    const next = backwards ? (at <= 0 ? stops.length - 1 : at - 1) : at < 0 || at === stops.length - 1 ? 0 : at + 1;
    stops[next].focus();
    return true;
  }

  prevents(path, action) {
    return path.some((node) => (this.meta.get(this.idOf(node))?.prevent ?? 0) & action);
  }

  record(kind, target, path, event = {}, extra = {}) {
    const w = new Writer();
    const box = target.getBoundingClientRect();
    const origin = this.root.getBoundingClientRect();
    w.u8(kind);
    w.u32(this.idOf(target));
    w.u32(path.length);
    for (const node of path) w.u32(this.idOf(node));
    w.f32(box.left - origin.left);
    w.f32(box.top - origin.top);
    w.f32(box.width);
    w.f32(box.height);
    w.f32(extra.x ?? (event.clientX ?? 0) - origin.left);
    w.f32(extra.y ?? (event.clientY ?? 0) - origin.top);
    w.u32(
      (event.shiftKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.altKey ? 4 : 0) | (event.metaKey ? 8 : 0),
    );
    w.u32(event.button > 0 ? event.button : 0);
    w.u32(event.detail > 0 ? event.detail : 0);
    w.f32(event.deltaX ?? 0);
    w.f32(event.deltaY ?? 0);
    w.u8(event.repeat ? 1 : 0);
    const editable = "selectionStart" in target && target.selectionStart !== null;
    w.u32(editable ? target.selectionStart : 0);
    w.u32(editable ? target.selectionEnd : 0);
    w.text(event.key ?? "");
    w.text(event.code ?? "");
    w.text("value" in target && typeof target.value === "string" ? target.value : "");
    w.text(event.inputType ?? "");
    return w;
  }

  // Sends `event` as a record of `kind` when a node on its path listens for it.
  forward(kind, event, target = event.target) {
    const path = this.pathTo(target);
    if (!path.length || !(this.hears(path, kind) || (kind === EVENT.click && this.links(path)))) {
      return { path, prevented: false };
    }
    const element = path[path.length - 1];
    const prevented = this.send(this.record(kind, element, path, event));
    if (prevented && event.cancelable) event.preventDefault();
    return { path, prevented };
  }

  // Non-bubbling kinds go to the one node, if it listens.
  direct(kind, node, event) {
    const path = this.pathTo(node);
    if (!path.length || path[path.length - 1] !== node) return;
    if (!((this.meta.get(this.idOf(node))?.listeners ?? 0) & (1 << kind))) return;
    this.send(this.record(kind, node, path, event));
  }

  listen() {
    const root = this.root;
    const on = (name, handler, options) => root.addEventListener(name, handler, options);

    on("pointerdown", (event) => {
      this.pointer = event.pointerId;
      const { path, prevented } = this.forward(EVENT.pointerDown, event);
      this.skipMouseDown = prevented || this.prevents(path, PREVENT_FOCUS);
    });
    on("mousedown", (event) => {
      // Focus moves on mousedown: this is where a prevented press keeps it where it is.
      if (this.skipMouseDown) event.preventDefault();
      this.skipMouseDown = false;
    });
    on("pointerup", (event) => this.forward(EVENT.pointerUp, event));
    on("pointercancel", (event) => this.forward(EVENT.pointerCancel, event));
    on("pointermove", (event) => this.forward(EVENT.pointerMove, event));
    on("gotpointercapture", (event) => this.forward(EVENT.gotPointerCapture, event));
    on("lostpointercapture", (event) => this.forward(EVENT.lostPointerCapture, event));
    on("click", (event) => this.forward(EVENT.click, event));
    // An image's load and error do not bubble; the root hears them while capturing.
    on("load", (event) => event.target instanceof HTMLImageElement && this.direct(EVENT.load, event.target, event), true);
    on("error", (event) => event.target instanceof HTMLImageElement && this.direct(EVENT.error, event.target, event), true);
    on("input", (event) => this.forward(EVENT.input, event));
    on(
      "wheel",
      (event) => {
        const { path } = this.forward(EVENT.wheel, event);
        if (this.prevents(path, PREVENT_SCROLL) && event.cancelable) event.preventDefault();
      },
      { passive: false },
    );
    on("focusin", (event) => this.direct(EVENT.focus, event.target, event));
    on("focusout", (event) => this.direct(EVENT.blur, event.target, event));
    on(
      "scroll",
      (event) => {
        const node = event.target;
        if (node.nodeType !== 1) return;
        const path = this.pathTo(node);
        if (!path.length || !((this.meta.get(this.idOf(node))?.listeners ?? 0) & (1 << EVENT.scroll))) return;
        this.send(this.record(EVENT.scroll, node, path, event, { x: node.scrollLeft, y: node.scrollTop }));
      },
      { capture: true, passive: true },
    );

    // Enter and leave: the nodes under the pointer now, against the ones before.
    const hover = (event, target) => {
      const next = target ? this.pathTo(target) : [];
      const before = this.hovered;
      this.hovered = next;
      for (let i = before.length - 1; i >= 0; i--) {
        if (!next.includes(before[i]) && before[i].isConnected) this.direct(EVENT.pointerLeave, before[i], event);
      }
      for (const node of next) {
        if (!before.includes(node)) this.direct(EVENT.pointerEnter, node, event);
      }
    };
    on("pointerover", (event) => hover(event, event.target));
    on("pointerleave", (event) => hover(event, null));

    // Keys go to the focused node, or to the root when focus is outside the program, so key
    // bindings work wherever focus is.
    const key = (kind) => (event) => {
      const inside = root.contains(event.target) && event.target !== root;
      if (!inside && event.target !== document.body && event.target !== document.documentElement) return;
      const target = inside ? event.target : this.nodes.get(this.rootId);
      if (!target) return;
      const { path, prevented } = this.forward(kind, event, target);
      if (kind !== EVENT.keyDown || prevented) return;
      if (this.prevents(path, PREVENT_KEYS)) {
        event.preventDefault();
        return;
      }
      if (inside && event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (this.trap(target, event.shiftKey)) event.preventDefault();
        return;
      }
      // A focused node that is not a native control is pressed with Enter and Space.
      const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
      const native = /^(INPUT|TEXTAREA|BUTTON|SELECT|A)$/.test(target.tagName);
      if (inside && plain && !event.repeat && !native && target.hasAttribute("tabindex")) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.forward(EVENT.click, event, target);
        }
      }
    };
    window.addEventListener("keydown", key(EVENT.keyDown));
    window.addEventListener("keyup", key(EVENT.keyUp));

    new ResizeObserver(() => {
      const size = this.size();
      this.call(CALL_RESIZE, size.width, size.height);
      this.place();
    }).observe(root);
    window.addEventListener("scroll", () => this.place(), { capture: true, passive: true });
    window.addEventListener("resize", () => this.place());

    // Back and forward: the program goes where the document's history went.
    window.addEventListener("popstate", () => this.locate());
  }
}

// The element names a node of each kind may have, the one a new node gets first.
const TAGS = [["DIV", "A"], ["#text"], ["IMG"], ["SPAN"], ["INPUT", "TEXTAREA"], ["CANVAS"]];

// How many floats follow each canvas command's code.
const CANVAS_FLOATS = [9, 2, 2, 4, 6, 0, 4, 5];

function now() {
  return performance.now() / 1000;
}
