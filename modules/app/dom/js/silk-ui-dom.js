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
};

// The listener flag of event kind `k` is `1 << k`.
const PREVENT_FOCUS = 1;
const PREVENT_SCROLL = 2;
const PREVENT_KEYS = 4;

// Later sheets win: a pressed node shows its active look over its hover look.
const STATES = [null, ":hover", ":active", ":focus", ":focus-visible"];
const STATE_ORDER = [1, 3, 4, 2];

const RESET = `
[data-silk] { outline: none; border-width: 0; -webkit-tap-highlight-color: transparent; }
[data-silk][role="button"] { user-select: none; -webkit-user-select: none; }
input[data-silk], textarea[data-silk] {
  font: inherit; color: inherit; background: transparent; border: 0 solid; margin: 0;
  padding: 0; min-width: 0; resize: none; appearance: none; border-radius: 0;
}
[data-silk]::selection { background: var(--silk-selection-color, highlight); }
[data-silk]::placeholder { color: var(--silk-placeholder-color, gray); opacity: 1; }
`;

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
    const value = decoder.decode(this.bytes.subarray(this.at, this.at + length));
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
 * `font-family` values: `{ 1: "Inter, sans-serif" }`. `imports` adds host modules the program
 * imports besides `dom` and `math`.
 */
export async function mount({ wasm, root, fonts = {}, imports = {} }) {
  const module = await compile(wasm);
  const page = new Page(root, fonts);
  const wanted = {};
  for (const entry of WebAssembly.Module.imports(module)) {
    const group = (wanted[entry.module] ??= {});
    if (entry.module === "dom") {
      group[entry.name] = page.imports[entry.name];
    } else if (imports[entry.module]?.[entry.name]) {
      group[entry.name] = imports[entry.module][entry.name];
    } else if (entry.module === "math" && typeof Math[entry.name] === "function") {
      group[entry.name] = Math[entry.name];
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
  constructor(root, fonts) {
    this.root = root;
    this.fonts = new Map(Object.entries(fonts).map(([id, names]) => [String(id), names]));
    this.nodes = new Map();
    this.meta = new Map();
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
    };

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
        if (id) this.send(this.record(EVENT.layout, entry.target, [entry.target]));
      }
    });
  }

  start(exports) {
    this.exports = exports;
    this.token = exports.silk_ui_open();
    if (!this.token) throw new Error("silk-ui: the program did not start");
    this.listen();
    const size = this.size();
    this.call(CALL_START, size.width, size.height, now());
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
      switch (op) {
        case 1:
          this.create(r.u32(), r.u8());
          break;
        case 2: {
          const parent = this.nodes.get(r.u32());
          const child = this.nodes.get(r.u32());
          const before = r.u32();
          parent.insertBefore(child, before ? this.nodes.get(before) : null);
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
          if (state === 0) this.nodes.get(id)?.removeAttribute?.("style");
          else this.dropRule(id, state);
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
            if (meta.listeners & bit) this.layout.observe(node);
            else this.layout.unobserve(node);
          }
          break;
        }
        case 11:
          this.rootId = r.u32();
          this.root.replaceChildren(this.nodes.get(this.rootId));
          break;
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
        default:
          throw new Error(`silk-ui: unknown mutation ${op}`);
      }
    }
  }

  create(id, kind) {
    let node;
    if (kind === KIND_TEXT) node = document.createTextNode("");
    else if (kind === KIND_INPUT) node = document.createElement("input");
    else if (kind === KIND_IMAGE) node = document.createElement("img");
    else if (kind === KIND_CANVAS) node = document.createElement("canvas");
    else if (kind === KIND_ICON) node = document.createElement("span");
    else node = document.createElement("div");
    if (node.nodeType === 1) node.dataset.silk = id;
    this.nodes.set(id, node);
    this.meta.set(id, { kind, listeners: 0, prevent: 0 });
  }

  destroy(id) {
    const node = this.nodes.get(id);
    if (!node) return;
    if (node.nodeType === 1) this.layout.unobserve(node);
    node.remove();
    this.nodes.delete(id);
    this.meta.delete(id);
    for (const state of STATE_ORDER) this.dropRule(id, state);
  }

  styleOf(id, state, make) {
    if (state === 0) return this.nodes.get(id).style;
    const { sheet, rules } = this.sheets[state];
    let rule = rules.get(id);
    if (!rule && make) {
      const at = sheet.insertRule(`[data-silk="${id}"]${STATES[state]} {}`, sheet.cssRules.length);
      rule = sheet.cssRules[at];
      rules.set(id, rule);
    }
    return rule?.style;
  }

  dropRule(id, state) {
    const { sheet, rules } = this.sheets[state];
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
        node.style.cursor = r.text();
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
        if ((r.u8() === 1) !== (node.tagName === "TEXTAREA")) this.retag(id, node);
        break;
      case 10:
        node.readOnly = r.u8() === 1;
        break;
      case 11:
        set("placeholder", r.text());
        break;
      case 12:
        set("aria-checked", r.u8() === 1 ? "true" : "false");
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
      default:
        throw new Error(`silk-ui: unknown attribute ${code}`);
    }
  }

  // Swaps an input for a textarea, or back, keeping what was set on it.
  retag(id, node) {
    const next = document.createElement(node.tagName === "TEXTAREA" ? "input" : "textarea");
    for (const attribute of node.attributes) next.setAttribute(attribute.name, attribute.value);
    next.value = node.value;
    node.replaceWith(next);
    this.nodes.set(id, next);
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
    return node?.dataset?.silk ? Number(node.dataset.silk) : 0;
  }

  // The program's elements from the root down to the one that holds `node`.
  pathTo(node) {
    const path = [];
    for (let at = node; at && at !== this.root; at = at.parentNode) {
      if (at.nodeType === 1 && at.dataset.silk) path.push(at);
    }
    if (!path.length || this.idOf(path[path.length - 1]) !== this.rootId) return [];
    return path.reverse();
  }

  hears(path, kind) {
    const bit = 1 << kind;
    return path.some((node) => (this.meta.get(this.idOf(node))?.listeners ?? 0) & bit);
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
    if (!path.length || !this.hears(path, kind)) return { path, prevented: false };
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
    }).observe(root);
  }
}

function now() {
  return performance.now() / 1000;
}
