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
const STATES = { base: 0, hover: 1, active: 2, focus: 3, focusVisible: 4, starting: 5 };

// Event types in the order of the tree's LISTEN_* flags: the index is the kind number the
// host dispatches and the bit a node listens with.
const TYPES = [
  "pointerdown", "pointerup", "click", "pointermove", "pointerenter", "pointerleave", "wheel",
  "keydown", "keyup", "focus", "blur", "input", "scroll", "layout", "pointercancel",
  "gotpointercapture", "lostpointercapture", "load", "error", "transitionrun", "transitionstart",
  "transitionend", "transitioncancel", "animationstart", "animationiteration", "animationend",
  "animationcancel", "selectionchange",
];
const KIND_OF = new Map(TYPES.map((type, kind) => [type, kind]));
const CLICK = KIND_OF.get("click");
// As on the web: these reach the target alone.
const NO_BUBBLE = new Set(["pointerenter", "pointerleave", "focus", "blur", "scroll", "layout", "load", "error"]);
// The tree has a default action to skip for these.
const CANCELABLE = new Set(["pointerdown", "pointerup", "click", "wheel", "keydown", "keyup"]);

// Properties whose numbers are not lengths. Every other number is CSS pixels.
const UNITLESS = new Set([
  "opacity", "flexGrow", "flexShrink", "flex", "order", "zIndex", "fontWeight", "lineHeight",
  "aspectRatio", "tabSize", "scale", "animationIterationCount", "gridRow", "gridRowStart", "gridRowEnd",
  "gridColumn", "gridColumnStart", "gridColumnEnd", "gridArea",
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

// ARIA states with a tree attribute of their own, by the name after `aria-`. The host takes
// the other ARIA names as they are; one it does not know is ignored, with one warning.
const ARIA_STATES = { checked: "checked", selected: "selected", expanded: "expanded" };
const ARIA_RANGE = { valuemin: 0, valuemax: 1, valuenow: 2 };
const warned = new Set();

function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

// The part of an ARIA attribute name after `aria`, lowercase: `aria-valuenow` (the DOM
// attribute) and `ariaValueNow` (the DOM property) are both `valuenow`. Null for other names.
function ariaName(name) {
  if (name.startsWith("aria-")) return name.slice(5).toLowerCase();
  if (name.length > 4 && name.startsWith("aria") && name[4] >= "A" && name[4] <= "Z") return name.slice(4).toLowerCase();
  return null;
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
  // aria-valuemin, aria-valuemax and aria-valuenow, which the tree takes as one range.
  #range = null;

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

  /** The look the tree lays over the base in `state`: hover, active, focus, focusVisible, or
   * starting (what transitions start from when the node first shows, as `@starting-style`). */
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
   *
   * `role` and `aria-*` work as in the DOM, spelled `aria-checked` or `ariaChecked`. A role
   * or ARIA name the tree does not know is ignored with a warning.
   */
  setAttribute(name, value) {
    if (name === "role") {
      const words = value == null ? "" : String(value);
      if (!native.attribute(this.id, "role", words)) warnOnce("the tree has no role '" + words + "': it is ignored");
      return;
    }
    const aria = ariaName(name);
    if (aria !== null) {
      this.#aria(aria, value);
      return;
    }
    if (name === "href") {
      this._href = value ? String(value) : null;
      this.#want(KIND_OF.get("click"));
    }
    native.attribute(this.id, name, value);
  }

  #aria(name, value) {
    if (name === "label") {
      native.attribute(this.id, "label", value == null ? "" : String(value));
    } else if (name in ARIA_STATES) {
      // ARIA states are the words "true" and "false"; anything else is false.
      if (name === "checked") native.attribute(this.id, "indeterminate", value === "mixed");
      native.attribute(this.id, ARIA_STATES[name], value === true || value === "true");
    } else if (name in ARIA_RANGE) {
      const range = (this.#range ??= [undefined, undefined, undefined]);
      range[ARIA_RANGE[name]] = value == null || value === "" ? undefined : Number(value);
      const [min = 0, max = 100, now] = range;
      if (now === undefined || Number.isNaN(now)) native.attribute(this.id, "valueRange");
      else native.attribute(this.id, "valueRange", min, max, now);
    } else if (!native.attribute(this.id, "aria-" + name, value == null ? "" : String(value))) {
      warnOnce("the tree has no 'aria-" + name + "' yet: it is ignored");
    }
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

  _selected(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
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

// Offsets cross the bridge as UTF-8 bytes; a rich input speaks JavaScript string indices.
const ASCII = /^[\x00-\x7f]*$/;

function byteOf(text, index) {
  if (ASCII.test(text)) return Math.min(index, text.length);
  let bytes = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function indexOf(text, byte) {
  if (ASCII.test(text)) return Math.min(byte, text.length);
  let bytes = 0;
  let i = 0;
  while (i < text.length && bytes < byte) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
    i++;
  }
  return i;
}

function cssTextOf(properties) {
  let css = "";
  for (const name of Object.keys(properties ?? {})) {
    const value = properties[name];
    if (value === null || value === undefined || value === "") continue;
    css += cssName(name) + ":" + cssValue(name, value) + ";";
  }
  return css;
}

/** Where an atom sits in a rich input's text: U+FFFC OBJECT REPLACEMENT CHARACTER. */
export const OBJECT = "\ufffc";

/**
 * A rich text field: styled runs (marks) and inline atoms (mentions, chips) over the text the
 * user edits, with the caret, selection, undo and input method composition of `Input`.
 *
 * Its `document` is `{ text, marks, atoms }`. Each atom sits in `text` as one `OBJECT`
 * character, so the caret steps over it as one unit; `atoms` lists them in text order as
 * `{ kind, label, data }`. `marks` lists `{ start, end, marks }` spans with mark names.
 * Offsets here, in `selectionStart` and in `insertAtom`, are string indices.
 */
export class RichInput extends Input {
  #markBits = new Map();
  #markNames = [];
  #kinds = new Map();
  #kindNames = [];
  #document = { text: "", marks: [], atoms: [] };

  constructor() {
    super();
    /** The marks text typed at the caret gets, as of the last change. */
    this.activeMarks = [];
  }

  #bit(name) {
    let bit = this.#markBits.get(name);
    if (bit === undefined) {
      bit = this.#markNames.length;
      if (bit >= 32) throw new RangeError("a rich input has at most 32 marks");
      this.#markBits.set(name, bit);
      this.#markNames.push(name);
    }
    return bit;
  }

  #kind(name) {
    let kind = this.#kinds.get(name);
    if (kind === undefined) {
      kind = this.#kindNames.length;
      this.#kinds.set(name, kind);
      this.#kindNames.push(name);
    }
    return kind;
  }

  #names(bits) {
    const names = [];
    for (let bit = 0; bit < this.#markNames.length; bit++) if (bits & (1 << bit)) names.push(this.#markNames[bit]);
    return names;
  }

  /** What text with mark `name` looks like: properties as `style.set` takes them. */
  defineMark(name, style) {
    native.mark(this.id, this.#bit(name), cssTextOf(style));
  }

  /** What atoms of `kind` look like: the inline block holding the label. */
  defineAtom(kind, style) {
    native.atomStyle(this.id, this.#kind(kind), cssTextOf(style));
  }

  get document() {
    return this.#document;
  }

  /** Replaces the document. The caret goes to the end and the undo history is forgotten. */
  set document(document) {
    const text = String(document?.text ?? "");
    const marks = (document?.marks ?? []).map((span) => ({ start: span.start, end: span.end, marks: [...span.marks] }));
    const atoms = (document?.atoms ?? []).map((atom) => ({ kind: atom.kind, label: String(atom.label ?? ""), data: atom.data ?? "" }));
    this.#document = { text, marks, atoms };
    let packedMarks = "";
    for (const span of marks) {
      let bits = 0;
      for (const name of span.marks) bits |= 1 << this.#bit(name);
      packedMarks += byteOf(text, span.start) + "," + byteOf(text, span.end) + "," + (bits >>> 0) + ";";
    }
    let packedAtoms = "";
    for (const atom of atoms) packedAtoms += this.#packAtom(atom);
    native.richText(this.id, text, packedMarks, packedAtoms);
    super._changed(text, text.length, text.length);
  }

  #packAtom(atom) {
    return this.#kind(atom.kind) + "\0" + String(atom.label ?? "") + "\0" + String(atom.data ?? "") + "\0";
  }

  /** Turns mark `name` on or off over the selection, or for the text typed next. */
  format(name, on = true) {
    native.format(this.id, this.#bit(name), !!on);
  }

  /** Turns mark `name` off where the caret's text has it, on where it does not. */
  toggleMark(name) {
    this.format(name, !this.activeMarks.includes(name));
  }

  /** Replaces the text from `start` to `end` with `atom` (`{ kind, label, data }`). */
  insertAtom(start, end, atom) {
    const text = this.#document.text;
    native.insertAtom(this.id, byteOf(text, start), byteOf(text, end), this.#packAtom(atom));
  }

  setSelectionRange(anchor, focus) {
    const text = this.#document.text;
    native.select(this.id, byteOf(text, anchor), byteOf(text, focus));
  }

  _changed(value, anchor, focus, marks, atoms, active) {
    super._changed(value, indexOf(value, anchor), indexOf(value, focus));
    if (marks === undefined) return;
    const spans = [];
    for (const part of String(marks).split(";")) {
      if (!part) continue;
      const [start, end, bits] = part.split(",").map(Number);
      spans.push({ start: indexOf(value, start), end: indexOf(value, end), marks: this.#names(bits) });
    }
    const list = [];
    const fields = String(atoms ?? "").split("\0");
    for (let i = 0; i + 2 < fields.length; i += 3) {
      list.push({ kind: this.#kindNames[Number(fields[i])] ?? Number(fields[i]), label: fields[i + 1], data: fields[i + 2] });
    }
    this.#document = { text: value, marks: spans, atoms: list };
    this.activeMarks = this.#names(active ?? 0);
  }

  _selected(start, end, active) {
    const text = this.#document.text;
    super._selected(indexOf(text, start), indexOf(text, end));
    this.activeMarks = this.#names(active ?? 0);
  }
}

/** A rich text field with `style` as its base look. */
export function createRichInput(style) {
  const input = new RichInput();
  if (style) input.style.set(style);
  return input;
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
  if (kind === "richinput") return new RichInput();
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
/**
 * Defines `@keyframes name` as CSS would: `{ from: { opacity: 0 }, "50%": {...}, to: {...} }`,
 * with selectors such as `"0%, 100%"` too. Style objects name it in `animation` or
 * `animationName`. Defining a name again replaces its rule; `null` removes it.
 */
export function defineKeyframes(name, frames) {
  for (const selector of Object.keys(frames ?? {})) {
    let css = "";
    const declarations = frames[selector];
    for (const property of Object.keys(declarations)) {
      const value = declarations[property];
      if (value === null || value === undefined || value === "") continue;
      css += cssName(property) + ":" + cssValue(property, value) + ";";
    }
    for (const part of selector.split(",")) {
      const text = part.trim().toLowerCase();
      const offset = text === "from" ? 0 : text === "to" ? 1 : parseFloat(text) / 100;
      if (!(offset >= 0 && offset <= 1)) throw new Error(`@silk/ui: bad keyframe selector '${part}'`);
      native.keyframe(offset, css);
    }
  }
  native.keyframes(String(name));
}

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

// The option bits of `__ui.markdown`.
const MARKDOWN_FLAGS = { tables: 1, strikethrough: 2, taskLists: 4, autolinkLiterals: 8, footnotes: 16, frontmatter: 32, alerts: 64 };
const GFM = 1 | 2 | 4 | 8;

/**
 * The syntax tree of Markdown `text`, in the shape of mdast (what remark gives): plain
 * objects with `type` and `children`. CommonMark, with GitHub's tables, strikethrough,
 * task lists and autolinks unless `gfm` is false. `footnotes`, `frontmatter` and
 * `alerts` (`> [!NOTE]`, a node of type `alert` with a `kind`) turn those on.
 */
export function parseMarkdown(text, options = {}) {
  let flags = options.gfm === false ? 0 : GFM;
  for (const name in MARKDOWN_FLAGS) {
    if (options[name] === true) flags |= MARKDOWN_FLAGS[name];
    else if (options[name] === false) flags &= ~MARKDOWN_FLAGS[name];
  }
  return JSON.parse(native.markdown(String(text), flags));
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

function fill(event, kind, a, b, modifiers, d, e, first, second, third, fourth) {
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
    event.target._changed?.(first, a, b, third, fourth, d);
    if (event.target instanceof RichInput) event.document = event.target.document;
  } else if (kind === 12) {
    event.scrollLeft = a;
    event.scrollTop = b;
  } else if (kind === 13) {
    event.bounds = { x: a, y: b, width: d, height: e };
  } else if (kind >= 19 && kind <= 22) {
    event.propertyName = first;
    event.elapsedTime = a;
    event.pseudoElement = "";
  } else if (kind === 27) {
    event.target._selected?.(a, b, d);
    event.selectionStart = event.target.selectionStart;
    event.selectionEnd = event.target.selectionEnd;
  } else if (kind >= 23) {
    event.animationName = first;
    event.elapsedTime = a;
    event.pseudoElement = "";
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
native.dispatch = function (kind, id, a, b, modifiers, d, e, first, second, third, fourth) {
  const target = nodes.get(id);
  if (!target) return false;
  const event = new Event(TYPES[kind], target);
  fill(event, kind, a, b, modifiers, d, e, first, second, third, fourth);
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
