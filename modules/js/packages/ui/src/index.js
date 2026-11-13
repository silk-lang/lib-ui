// @silk/ui: the nodes of a Silk UI tree and their events, for JavaScript that runs on the
// embedded SilkJS engine. The primitives are the tree's own (box, text, input, image, icon,
// canvas); the methods and the event flow are the DOM's, so code written for the web reads
// the same here.
//
// Every call queues a mutation through the native `__ui` functions. The host applies the
// queue after the script, and after each event it delivers.

const native = globalThis.__ui;
if (!native) throw new Error("@silk/ui needs the __ui functions of a ui-js host");

const KINDS = { box: 0, text: 1, input: 2, image: 3, icon: 4, canvas: 5 };
const STATES = { base: 0, hover: 1, active: 2, focus: 3, focusVisible: 4 };

// Event types in the order of the tree's LISTEN_* flags: the index is the kind number the
// host dispatches and the bit a node listens with.
const TYPES = [
  "pointerdown", "pointerup", "click", "pointermove", "pointerenter", "pointerleave", "wheel",
  "keydown", "keyup", "focus", "blur", "input", "scroll", "layout", "pointercancel",
  "gotpointercapture", "lostpointercapture",
];
const KIND_OF = new Map(TYPES.map((type, kind) => [type, kind]));
const CLICK = KIND_OF.get("click");
// As on the web: these reach the target alone.
const NO_BUBBLE = new Set(["pointerenter", "pointerleave", "focus", "blur", "scroll", "layout"]);
// The tree has a default action to skip for these.
const CANCELABLE = new Set(["pointerdown", "pointerup", "click", "wheel", "keydown", "keyup"]);

// Properties whose numbers are not lengths. Every other number is CSS pixels.
const UNITLESS = new Set([
  "opacity", "flexGrow", "flexShrink", "flex", "order", "zIndex", "fontWeight", "lineHeight",
  "aspectRatio", "tabSize", "scale",
]);

const nodes = new Map();
const NO_CHILDREN = Object.freeze([]);
let nextId = 0;

// Property names repeat across nodes: each is converted once.
const CSS_NAMES = new Map();

function cssName(name) {
  let css = CSS_NAMES.get(name);
  if (css === undefined) {
    css = name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
    CSS_NAMES.set(name, css);
  }
  return css;
}

// The tree names font family lists by number: each `fontFamily` text is defined once, as a
// list of its own. The numbers start high, clear of the lists a host defines, and stay
// small enough to be exact in the 32-bit float a style value is.
const FAMILIES = new Map();
let nextFamily = 0x10000;

function familyOf(names) {
  let id = FAMILIES.get(names);
  if (id === undefined) {
    id = nextFamily++;
    FAMILIES.set(names, id);
    native.fontFamily(id, names);
  }
  return String(id);
}

function cssValue(name, value) {
  if (name === "fontFamily") return familyOf(String(value));
  return typeof value === "number" && !UNITLESS.has(name) ? value + "px" : String(value);
}

/** The declarations of one look of a node: the base look, or what a state lays over it. */
class Look {
  #node;
  #state;
  // Plain objects share their shape across nodes: a Map here costs four times the memory.
  #values = Object.create(null);

  constructor(node, state) {
    this.#node = node;
    this.#state = state;
  }

  /**
   * Sets properties by their camel case names: `{ width: 120, backgroundColor: "red" }`.
   * Numbers are CSS pixels except for unitless properties. `null`, `undefined` and `""`
   * take a property out.
   */
  set(properties) {
    let css = "";
    let removed = false;
    for (const name of Object.keys(properties)) {
      const value = properties[name];
      if (value === null || value === undefined || value === "") {
        if (name in this.#values) {
          delete this.#values[name];
          removed = true;
        }
        continue;
      }
      const text = cssValue(name, value);
      if (this.#values[name] === text) continue;
      this.#values[name] = text;
      css += cssName(name) + ":" + text + ";";
    }
    if (removed) {
      // The tree sets declarations over earlier ones, so taking one out means starting the
      // look again.
      native.clearStyle(this.#node.id, this.#state);
      css = this.cssText;
    }
    if (css) native.style(this.#node.id, css, this.#state);
  }

  /** Replaces the whole look. */
  replace(properties) {
    native.clearStyle(this.#node.id, this.#state);
    this.#values = Object.create(null);
    this.set(properties);
  }

  get(name) {
    return this.#values[name];
  }

  get cssText() {
    let css = "";
    for (const name in this.#values) css += cssName(name) + ":" + this.#values[name] + ";";
    return css;
  }
}

/** A node of the tree. Make one with `createBox`, `createText`, `createInput` or `createNode`. */
export class Node {
  #listeners = null;
  // The base look, and the state looks by name: most nodes have the base alone.
  #base = null;
  #looks = null;
  #flags = 0;

  constructor(kind) {
    this.id = ++nextId;
    this.kind = kind;
    this.parentNode = null;
    // A text leaf has no children: they all share one empty list.
    this.childNodes = kind === "text" ? NO_CHILDREN : [];
    nodes.set(this.id, this);
    native.create(this.id, KINDS[kind]);
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }

  get previousSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) - 1] ?? null : null;
  }

  /** Whether `other` is this node or inside it. */
  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  /** Inserts `child` before `before`, or last without it. A child already in the tree moves. */
  insertBefore(child, before = null) {
    if (child.contains(this)) throw new Error("a node cannot be inserted into itself or its own subtree");
    if (before && before.parentNode !== this) throw new Error("the node to insert before is not a child of this node");
    if (before === child) return child;
    const old = child.parentNode;
    if (old) old.childNodes.splice(old.childNodes.indexOf(child), 1);
    child.parentNode = this;
    if (before) {
      this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
      native.insertBefore(this.id, child.id, before.id);
    } else {
      this.childNodes.push(child);
      native.append(this.id, child.id);
    }
    return child;
  }

  appendChild(child) {
    return this.insertBefore(child, null);
  }

  /** Appends nodes, and strings as text nodes. */
  append(...children) {
    for (const child of children) this.insertBefore(typeof child === "string" ? createText(child) : child, null);
  }

  /** Detaches `child` and its subtree. It keeps its state and can be inserted again. */
  removeChild(child) {
    if (child.parentNode !== this) throw new Error("the node to remove is not a child of this node");
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    native.remove(child.id);
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  /** Detaches and frees this node and its subtree. They cannot be used again. */
  destroy() {
    const parent = this.parentNode;
    if (parent) {
      parent.childNodes.splice(parent.childNodes.indexOf(this), 1);
      this.parentNode = null;
    }
    native.destroy(this.id);
    forget(this);
  }

  /**
   * The base look. `node.style.set({ width: 120 })` sets properties,
   * `node.style = { ... }` replaces the look.
   */
  get style() {
    return this.look("base");
  }

  set style(properties) {
    this.look("base").replace(properties);
  }

  /** The look the tree lays over the base in `state`: hover, active, focus or focusVisible. */
  look(state) {
    if (state === "base") return (this.#base ??= new Look(this, 0));
    if (!(state in STATES)) throw new TypeError("the tree has no look '" + state + "'");
    this.#looks ??= Object.create(null);
    return (this.#looks[state] ??= new Look(this, STATES[state]));
  }

  /**
   * Sets a tree attribute: tabIndex, disabled, label, testId, placeholder and so on. A node
   * with an `href` is a link: a click on it or inside it that no listener prevented opens
   * the address with `open`, as a click on an `<a>` follows it.
   */
  setAttribute(name, value) {
    if (name === "href") {
      this._href = value ? String(value) : null;
      this.#want(KIND_OF.get("click"));
    }
    native.attribute(this.id, name, value);
  }

  // Tells the tree which events this node wants: its listeners', and clicks on a link.
  #want(kind) {
    const list = this.#listeners?.get(TYPES[kind]);
    const wanted = (list && list.length > 0) || (kind === CLICK && this._href);
    const flags = wanted ? this.#flags | (1 << kind) : this.#flags & ~(1 << kind);
    if (flags !== this.#flags) native.listen(this.id, (this.#flags = flags));
  }

  set tabIndex(value) {
    native.attribute(this.id, "tabIndex", value);
  }

  set disabled(value) {
    native.attribute(this.id, "disabled", value);
  }

  focus() {
    native.focus(this.id);
  }

  scrollTo(x, y) {
    native.scrollTo(this.id, x, y);
  }

  /**
   * As on the web. `options` is `true` or `{ capture: true }` for the capture phase, and
   * `{ once: true }` for a listener that runs once.
   */
  addEventListener(type, listener, options) {
    const kind = KIND_OF.get(type);
    if (kind === undefined) throw new TypeError("the tree has no event '" + type + "'");
    const capture = options === true || !!options?.capture;
    this.#listeners ??= new Map();
    let list = this.#listeners.get(type);
    if (!list) this.#listeners.set(type, (list = []));
    if (list.some((entry) => entry.listener === listener && entry.capture === capture)) return;
    list.push({ listener, capture, once: !!options?.once });
    this.#want(kind);
  }

  removeEventListener(type, listener, options) {
    const list = this.#listeners?.get(type);
    if (!list) return;
    const capture = options === true || !!options?.capture;
    const index = list.findIndex((entry) => entry.listener === listener && entry.capture === capture);
    if (index < 0) return;
    list.splice(index, 1);
    this.#want(KIND_OF.get(type));
  }

  /** Runs the capture or the bubble listeners of `event.type`. Used by the dispatcher. */
  _run(event, capture) {
    const list = this.#listeners?.get(event.type);
    if (!list) return;
    for (const entry of list.slice()) {
      if (event._immediate) return;
      if (entry.capture !== capture) continue;
      if (entry.once) this.removeEventListener(event.type, entry.listener, entry.capture);
      try {
        if (typeof entry.listener === "function") entry.listener.call(this, event);
        else entry.listener.handleEvent(event);
      } catch (error) {
        reportError(error);
      }
    }
  }
}

/** A text leaf. It takes its look from its parent. */
export class Text extends Node {
  #data = "";

  constructor(data = "") {
    super("text");
    this.data = data;
  }

  get data() {
    return this.#data;
  }

  set data(value) {
    value = String(value);
    if (value === this.#data && value !== "") return;
    this.#data = value;
    native.setText(this.id, value);
  }

  get textContent() {
    return this.#data;
  }

  set textContent(value) {
    this.data = value;
  }
}

/** An editable text field. `value` follows what the user types. */
export class Input extends Node {
  #value = "";

  constructor() {
    super("input");
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }

  get value() {
    return this.#value;
  }

  set value(value) {
    this.#value = String(value);
    native.setText(this.id, this.#value);
  }

  /** Selects from `anchor` to `focus`, as UTF-8 byte offsets in the value. */
  setSelectionRange(anchor, focus) {
    native.select(this.id, anchor, focus);
  }

  _changed(value, anchor, focus) {
    this.#value = value;
    this.selectionStart = Math.min(anchor, focus);
    this.selectionEnd = Math.max(anchor, focus);
  }
}

// Inline SVG markup as icon resources: identical markup shares one, freed when no icon shows
// it. The ids start high, clear of resources a host or a URL table numbers from 1.
const ICONS = new Map();
let nextIcon = 0x40000000;

function holdIcon(markup) {
  let entry = ICONS.get(markup);
  if (!entry) {
    entry = { id: nextIcon++, count: 0 };
    ICONS.set(markup, entry);
    native.defineIcon(entry.id, markup);
  }
  entry.count++;
  return entry.id;
}

function dropIcon(markup) {
  const entry = ICONS.get(markup);
  if (entry && --entry.count === 0) {
    ICONS.delete(markup);
    native.release(entry.id);
  }
}

/**
 * An icon: SVG drawn at the node's CSS size, as an inline `<svg>` is. Its `currentColor` is
 * the node's `color`, so an icon that paints only with it (Lucide's, for example) takes the
 * text color, and any other keeps its own colors.
 */
export class Icon extends Node {
  #svg = "";

  constructor(svg = "") {
    super("icon");
    this.svg = svg;
  }

  /** The SVG markup, as `outerHTML` of an `<svg>` element would give it. */
  get svg() {
    return this.#svg;
  }

  set svg(markup) {
    markup = markup == null ? "" : String(markup);
    if (markup === this.#svg) return;
    if (this.#svg) dropIcon(this.#svg);
    this.#svg = markup;
    native.source(this.id, markup ? holdIcon(markup) : 0);
  }

  _forget() {
    if (this.#svg) dropIcon(this.#svg);
    this.#svg = "";
  }
}

function forget(node) {
  nodes.delete(node.id);
  node._forget?.();
  for (const child of node.childNodes) {
    child.parentNode = null;
    forget(child);
  }
  node.childNodes = [];
}

export function createNode(kind) {
  if (!(kind in KINDS)) throw new TypeError("the tree has no node kind '" + kind + "'");
  if (kind === "text") return new Text();
  if (kind === "input") return new Input();
  if (kind === "icon") return new Icon();
  return new Node(kind);
}

/** A box with `style` as its base look and `children` appended. */
export function createBox(style, ...children) {
  const box = new Node("box");
  if (style) box.style.set(style);
  box.append(...children);
  return box;
}

export function createText(data = "") {
  return new Text(data);
}

/** An icon showing `svg` markup, with `style` as its base look. */
export function createIcon(svg, style) {
  const icon = new Icon(svg);
  if (style) icon.style.set(style);
  return icon;
}

export function createInput(style) {
  const input = new Input();
  if (style) input.style.set(style);
  return input;
}

let rootNode = null;

/** Makes `node` the root of the window's tree. */
export function mount(node) {
  rootNode = node;
  native.root(node.id);
  return node;
}

export function root() {
  return rootNode;
}

/** The node with tree id `id`, for hosts and tools. */
export function nodeById(id) {
  return nodes.get(id) ?? null;
}

let errorHandler = null;
let pendingError = null;

/**
 * What happens to an exception a listener throws. As on the web, it does not stop the
 * dispatch. Without a handler, the host reports the first one after the input is handled.
 */
export function setErrorHandler(handler) {
  errorHandler = handler;
}

function reportError(error) {
  if (errorHandler) errorHandler(error);
  else pendingError ??= { error };
}

/** An event of the tree, with the members of the DOM event it corresponds to. */
export class Event {
  constructor(type, target) {
    this.type = type;
    this.target = target;
    this.currentTarget = null;
    this.eventPhase = 0;
    this.bubbles = !NO_BUBBLE.has(type);
    this.cancelable = CANCELABLE.has(type);
    this.defaultPrevented = false;
    this._stopped = false;
    this._immediate = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation() {
    this._stopped = true;
  }

  stopImmediatePropagation() {
    this._stopped = true;
    this._immediate = true;
  }

  /** The nodes the event passes, target first. */
  composedPath() {
    const path = [];
    for (let node = this.target; node; node = node.parentNode) path.push(node);
    return path;
  }
}

function fill(event, kind, a, b, modifiers, d, e, first, second) {
  if (kind <= 6 || kind === 14) {
    event.clientX = event.x = a;
    event.clientY = event.y = b;
  }
  if (kind <= 8 || kind === 14) {
    event.shiftKey = (modifiers & 1) !== 0;
    event.ctrlKey = (modifiers & 2) !== 0;
    event.altKey = (modifiers & 4) !== 0;
    event.metaKey = (modifiers & 8) !== 0;
  }
  if (kind <= 2) {
    event.button = d;
    event.detail = e;
  } else if (kind === 6) {
    event.deltaX = d;
    event.deltaY = e;
  } else if (kind === 7 || kind === 8) {
    event.key = first;
    event.code = second;
    event.repeat = d !== 0;
  } else if (kind === 11) {
    event.value = first;
    event.inputType = second;
    event.target._changed?.(first, a, b);
  } else if (kind === 12) {
    event.scrollLeft = a;
    event.scrollTop = b;
  } else if (kind === 13) {
    event.bounds = { x: a, y: b, width: d, height: e };
  }
}

/**
 * Runs `event` through the tree as the DOM does: the capture phase from the root down, the
 * target, then the bubble phase back up for events that bubble. Returns false when a
 * listener prevented the default.
 */
export function dispatchEvent(event) {
  const path = event.composedPath();
  for (let i = path.length - 1; i > 0 && !event._stopped; i--) {
    event.eventPhase = 1;
    event.currentTarget = path[i];
    path[i]._run(event, true);
  }
  if (!event._stopped) {
    event.eventPhase = 2;
    event.currentTarget = path[0];
    path[0]._run(event, true);
    if (!event._stopped) path[0]._run(event, false);
  }
  if (event.bubbles) {
    for (let i = 1; i < path.length && !event._stopped; i++) {
      event.eventPhase = 3;
      event.currentTarget = path[i];
      path[i]._run(event, false);
    }
  }
  event.eventPhase = 0;
  event.currentTarget = null;
  return !event.defaultPrevented;
}

// The host calls this for every event record, before the tree runs the default action.
native.dispatch = function (kind, id, a, b, modifiers, d, e, first, second) {
  const target = nodes.get(id);
  if (!target) return false;
  const event = new Event(TYPES[kind], target);
  fill(event, kind, a, b, modifiers, d, e, first, second);
  dispatchEvent(event);
  if (kind === CLICK && !event.defaultPrevented) follow(target);
  return event.defaultPrevented;
};

// The default action of a click: the nearest link around the target opens.
function follow(target) {
  for (let node = target; node; node = node.parentNode) {
    if (node._href) {
      try {
        globalThis.open(node._href);
      } catch (error) {
        reportError(error);
      }
      return;
    }
  }
}

// The host calls this before it replaces the realm, on a reload: every node goes, so the
// next realm starts on an empty tree.
native.unload = function () {
  for (const node of [...nodes.values()]) if (!node.parentNode && nodes.has(node.id)) node.destroy();
  rootNode = null;
};

// The host calls this after it handled an input: an exception a listener threw surfaces here.
native.takeError = function () {
  if (!pendingError) return;
  const { error } = pendingError;
  pendingError = null;
  throw error;
};
