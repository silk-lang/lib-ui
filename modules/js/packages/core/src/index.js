// @silkui/core: the nodes of a Silk UI tree and their events, for JavaScript that runs on the
// embedded SilkJS engine. The primitives are the tree's own (box, text, input, image, canvas)
// and inline svg; the methods and the event flow are the DOM's, so code written for the web reads
// the same here.
//
// Every call queues a mutation through the native `__ui` functions. The host applies the
// queue after the script, and after each event it delivers.

const native = globalThis.__ui;
if (!native) throw new Error("@silkui/core needs the __ui functions of a ui-js host");

const KINDS = { box: 0, text: 1, input: 2, image: 3, icon: 4, canvas: 5 };
const STATES = { base: 0, hover: 1, active: 2, focus: 3, focusVisible: 4, starting: 5 };

// Event types by the kind number the host dispatches. Up to `selectionchange`, `pointerover`
// and `pointerout` the kind is also the bit of the tree's LISTEN_* flags a node listens with;
// `error` shares the bit of `load`, the touch kinds share bit 30, copy, cut, paste and
// beforeinput bit 31, and the requests (closerequest, navigate) bit 18 (see `bitOf`).
const TYPES = [
  "pointerdown", "pointerup", "click", "pointermove", "pointerenter", "pointerleave", "wheel",
  "keydown", "keyup", "focus", "blur", "input", "scroll", "layout", "pointercancel",
  "gotpointercapture", "lostpointercapture", "load", "error", "transitionrun", "transitionstart",
  "transitionend", "transitioncancel", "animationstart", "animationiteration", "animationend",
  "animationcancel", "selectionchange", "pointerover", "pointerout", "touchstart", "touchmove",
  "touchend", "touchcancel", "copy", "cut", "paste", "beforeinput", "closerequest", "navigate",
];
const KIND_OF = new Map(TYPES.map((type, kind) => [type, kind]));

// The live `Range`s (see Range below), held weakly: a range nobody holds stops being updated.
const liveRanges = new Set();
// The `MutationObserver`s observing a node (see MutationObserver below). While there are none
// a mutation costs one size check.
const mutationObservers = new Set();

function eachLiveRange(update) {
  for (const ref of liveRanges) {
    const range = ref.deref();
    if (range) update(range);
    else liveRanges.delete(ref);
  }
}

const CLICK = KIND_OF.get("click");
const FOCUS = KIND_OF.get("focus");
const BLUR = KIND_OF.get("blur");
const SELECTION_CHANGE = KIND_OF.get("selectionchange");
const TOUCH_START = KIND_OF.get("touchstart");
const COPY = KIND_OF.get("copy");
const CUT = KIND_OF.get("cut");
const PASTE = KIND_OF.get("paste");
const BEFORE_INPUT = KIND_OF.get("beforeinput");
const LOAD = KIND_OF.get("load");
const ERROR = KIND_OF.get("error");
const CLOSE_REQUEST = KIND_OF.get("closerequest");
const NAVIGATE = KIND_OF.get("navigate");
// The listen bit of a kind: `error` shares the bit of `load`, the touch kinds share bit 30,
// copy, cut, paste and beforeinput bit 31, and the two requests have the bit after `load`.
const bitOf = (kind) =>
  kind === ERROR ? LOAD : kind < TOUCH_START ? kind : kind < COPY ? 30 : kind < CLOSE_REQUEST ? 31 : LOAD + 1;
const SHARES_BIT = (kind) => kind >= TOUCH_START || kind === LOAD || kind === ERROR;
const KINDS_OF_BIT = (bit) => TYPES.map((_, kind) => kind).filter((kind) => bitOf(kind) === bit);
// Compatibility mouse events, as the web fires them after pointer events: each listens
// through the pointer kind it follows.
const MOUSE_OF = new Map([
  ["pointerdown", "mousedown"], ["pointerup", "mouseup"], ["pointermove", "mousemove"],
  ["pointerover", "mouseover"], ["pointerout", "mouseout"], ["pointerenter", "mouseenter"],
  ["pointerleave", "mouseleave"],
]);
const POINTER_OF = new Map([...MOUSE_OF].map(([pointer, mouse]) => [mouse, pointer]));
// Types the tree reports through another kind's records: `selectstart` comes as a
// `SelectionChange` record at the node pressed.
const LISTENS_AS = new Map([...POINTER_OF, ["selectstart", "selectionchange"]]);
// As on the web: these reach the target alone.
const NO_BUBBLE = new Set([
  "pointerenter", "pointerleave", "mouseenter", "mouseleave", "focus", "blur", "scroll", "layout", "load",
  "error",
]);
// The tree has a default action to skip for these. Touch records say for themselves.
const CANCELABLE = new Set([
  "pointerdown", "pointerup", "click", "wheel", "keydown", "keyup", "dragenter", "dragover", "drop",
  "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "selectstart", "copy", "cut", "paste", "beforeinput",
  "closerequest", "navigate",
]);
// Files dragged from the desktop: the host dispatches these itself, so nodes need no flag.
const DRAG_TYPES = new Set(["dragenter", "dragover", "dragleave", "drop"]);

// Properties whose numbers are not lengths. Every other number is CSS pixels.
const UNITLESS = new Set([
  "opacity", "flexGrow", "flexShrink", "flex", "order", "zIndex", "fontWeight", "lineHeight",
  "aspectRatio", "tabSize", "scale", "animationIterationCount", "gridRow", "gridRowStart", "gridRowEnd",
  "gridColumn", "gridColumnStart", "gridColumnEnd", "gridArea", "columnCount", "columns", "orphans", "widows",
]);

const nodes = new Map();
// HTML boolean attributes that are also the tree's own.
const BOOLEAN_TREE_ATTRIBUTES = new Set(["disabled", "checked", "selected", "inert", "readonly", "multiline"]);
// The tag stylesheets match a tree node by, by its kind (see ui-tree's `SelectorTree`).
const LOCAL_NAMES = { box: "div", input: "input", image: "img", canvas: "canvas", svg: "svg", text: "#text" };
const NO_CHILDREN = Object.freeze([]);
let nextId = 0;

// Property names repeat across nodes: each is converted once.
const CSS_NAMES = new Map();

function cssName(name) {
  if (name.startsWith("--")) return name;
  let css = CSS_NAMES.get(name);
  if (css === undefined) {
    css = name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
    CSS_NAMES.set(name, css);
  }
  return css;
}

// A CSS name as the camel case name looks take: `background-color` is `backgroundColor`,
// `-webkit-line-clamp` is `WebkitLineClamp`; custom properties stay as they are.
function camelName(name) {
  if (name.startsWith("--") || !name.includes("-")) return name;
  return name.replace(/^-ms-/, "ms-").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

// `color: red; --gap: 4px` as camel case properties. Semicolons inside parentheses or
// quotes (`url("a;b")`) stay in their value.
function parseDeclarations(text) {
  const properties = {};
  let depth = 0;
  let quote = "";
  let start = 0;
  const take = (end) => {
    const part = text.slice(start, end);
    const colon = part.indexOf(":");
    if (colon > 0) {
      const name = part.slice(0, colon).trim();
      const value = part.slice(colon + 1).trim();
      if (name && value) properties[camelName(name.startsWith("--") ? name : name.toLowerCase())] = value;
    }
    start = end + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth <= 0) take(i);
  }
  take(text.length);
  return properties;
}

// `element.style` of an HTML element: the base look, whose CSS properties also read and write
// as fields (`style.height = "10px"`), as a CSSStyleDeclaration's do.
const styleProxies = new WeakMap();
function styleProxy(look) {
  let proxy = styleProxies.get(look);
  if (proxy) return proxy;
  proxy = new Proxy(look, {
    get(target, key) {
      if (typeof key !== "string" || key in target) {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return target.get(key) ?? "";
    },
    set(target, key, value) {
      if (typeof key !== "string" || key in target) return Reflect.set(target, key, value, target);
      target.set({ [key]: value });
      return true;
    },
  });
  styleProxies.set(look, proxy);
  return proxy;
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
  if (name.startsWith("--")) return String(value);
  if (name === "fontFamily") return familyOf(String(value));
  return typeof value === "number" && !UNITLESS.has(name) ? value + "px" : String(value);
}

const warned = new Set();
// Style elements, and those in the document's sheets now (see `StyleElement`).
const styleElements = new Set();
let appliedStyles = [];
let stylesPending = false;

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
  // A number or string is kept as given, which the caller's style object holds too, and
  // turned into CSS text when it is read: no node keeps a string of its own per value.
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
      if (this.#values[name] === value) continue;
      const text = cssValue(name, value);
      this.#values[name] = typeof value === "number" || typeof value === "string" ? value : text;
      css += cssName(name) + ":" + text + ";";
    }
    if (removed) {
      // The tree sets declarations over earlier ones, so taking one out means starting the
      // look again.
      native.clearStyle(this.#node.nodeId, this.#state);
      css = this.cssText;
    }
    if (css) native.style(this.#node.nodeId, css, this.#state);
  }

  /** Replaces the whole look. */
  replace(properties) {
    native.clearStyle(this.#node.nodeId, this.#state);
    this.#values = Object.create(null);
    this.set(properties);
  }

  get(name) {
    const value = this.#values[name];
    return value === undefined ? undefined : cssValue(name, value);
  }

  get cssText() {
    let css = "";
    for (const name in this.#values) css += cssName(name) + ":" + cssValue(name, this.#values[name]) + ";";
    return css;
  }

  /** Replaces the look with declarations in CSS text, as `element.style.cssText`. */
  set cssText(text) {
    this.replace(parseDeclarations(String(text ?? "")));
  }

  get length() {
    return Object.keys(this.#values).length;
  }

  item(index) {
    const name = Object.keys(this.#values)[index];
    return name === undefined ? "" : cssName(name);
  }

  // CSSStyleDeclaration's methods, which take CSS names (`background-color`, `--gap`).
  setProperty(name, value, priority) {
    const text = value === null || value === undefined ? "" : String(value) + (priority === "important" ? " !important" : "");
    this.set({ [camelName(String(name))]: text });
  }

  removeProperty(name) {
    const camel = camelName(String(name));
    const old = this.get(camel) ?? "";
    this.set({ [camel]: null });
    return old;
  }

  getPropertyValue(name) {
    return this.get(camelName(String(name))) ?? "";
  }

  getPropertyPriority() {
    return "";
  }

  _copyTo(look) {
    look.#values = Object.assign(Object.create(null), this.#values);
    const css = this.cssText;
    if (css) native.style(look.#node.nodeId, css, look.#state);
  }
}

const CLASS_SPACE = /[\t\n\f\r ]/;
function classToken(value) {
  const token = String(value);
  if (!token || CLASS_SPACE.test(token)) {
    const error = new Error(!token ? "A class token cannot be empty" : "A class token cannot contain whitespace");
    error.name = !token ? "SyntaxError" : "InvalidCharacterError";
    throw error;
  }
  return token;
}

/** A live token list backed by the node's class attribute. */
// `element.dataset`: a DOMStringMap over the `data-*` attributes, `fooBar` for `data-foo-bar`.
function datasetOf(element) {
  const attribute = (key) => typeof key === "string" && !/-[a-z]/.test(key) ? "data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) : null;
  const keys = () => element.getAttributeNames().filter((name) => name.startsWith("data-")).map((name) => name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
  return new Proxy(Object.create(null), {
    get(_, key) {
      const name = attribute(key);
      return name === null ? undefined : element.getAttribute(name) ?? undefined;
    },
    set(_, key, value) {
      const name = attribute(key);
      if (name === null) throw new (globalThis.DOMException ?? Error)("'" + String(key) + "' is not a valid dataset name", "SyntaxError");
      element.setAttribute(name, String(value));
      return true;
    },
    deleteProperty(_, key) {
      const name = attribute(key);
      if (name !== null) element.removeAttribute(name);
      return true;
    },
    has(_, key) {
      const name = attribute(key);
      return name !== null && element.hasAttribute(name);
    },
    ownKeys: keys,
    getOwnPropertyDescriptor(_, key) {
      const name = attribute(key);
      const value = name === null ? null : element.getAttribute(name);
      return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
  });
}

export class ClassList {
  #node;
  constructor(node) { this.#node = node; }
  #tokens() { return [...new Set(this.value.split(/[\t\n\f\r ]+/).filter(Boolean))]; }
  #write(tokens) { this.#node.className = tokens.join(" "); }
  get value() { return this.#node.className; }
  set value(value) { this.#node.className = value; }
  get length() { return this.#tokens().length; }
  item(index) { return this.#tokens()[Number(index) >>> 0] ?? null; }
  contains(token) { return this.#tokens().includes(classToken(token)); }
  add(...values) {
    const tokens = values.map(classToken);
    this.#write([...new Set([...this.#tokens(), ...tokens])]);
  }
  remove(...values) {
    const tokens = values.map(classToken);
    this.#write(this.#tokens().filter((token) => !tokens.includes(token)));
  }
  toggle(value, force) {
    const token = classToken(value);
    const present = this.contains(token);
    const wanted = force === undefined ? !present : !!force;
    if (wanted && !present) this.add(token);
    else if (!wanted && present) this.remove(token);
    return wanted;
  }
  replace(oldValue, newValue) {
    const oldToken = classToken(oldValue), newToken = classToken(newValue);
    const tokens = this.#tokens(), index = tokens.indexOf(oldToken);
    if (index === -1) return false;
    if (oldToken !== newToken) {
      if (tokens.includes(newToken)) tokens.splice(index, 1);
      else tokens[index] = newToken;
    }
    this.#write(tokens);
    return true;
  }
  values() { return this.#tokens().values(); }
  keys() { return this.#tokens().keys(); }
  entries() { return this.#tokens().entries(); }
  forEach(callback, thisArg) { this.#tokens().forEach((value, index) => callback.call(thisArg, value, index, this)); }
  [Symbol.iterator]() { return this.values(); }
  toString() { return this.value; }
}

const sheetData = new WeakMap();
const adoptedLists = new WeakMap();
const importedSheets = new Map();
let installedSheets = [];
let nextSheet = 1;

function sheetError(message) {
  const error = new Error(message);
  error.name = "NotAllowedError";
  return error;
}

function base64Bytes(value) {
  if (typeof value === "string") return value;
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected compiled stylesheet bytes");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const bits = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    encoded += alphabet[bits >>> 18] + alphabet[(bits >>> 12) & 63]
      + (i + 1 < bytes.length ? alphabet[(bits >>> 6) & 63] : "=")
      + (i + 2 < bytes.length ? alphabet[bits & 63] : "=");
  }
  return encoded;
}

function replaceSheet(sheet, bytes) {
  native.styleSheet(0, 0, bytes);
  const state = sheetData.get(sheet);
  state.bytes = bytes;
  for (const entry of installedSheets) {
    if (entry.sheet !== sheet) continue;
    native.styleSheet(entry.live ? 2 : 1, entry.id, bytes);
    entry.live = true;
  }
}

/** A constructed stylesheet, adopted on an application's root. */
export class CSSStyleSheet {
  constructor() { sheetData.set(this, { bytes: null, replacing: false }); }

  static fromCompiled(bytes) {
    const sheet = new CSSStyleSheet();
    replaceSheet(sheet, base64Bytes(bytes));
    return sheet;
  }

  replaceCompiled(bytes) {
    if (sheetData.get(this).replacing) throw sheetError("A stylesheet replacement is already pending");
    replaceSheet(this, base64Bytes(bytes));
  }

  replaceSync(text) {
    if (sheetData.get(this).replacing) throw sheetError("A stylesheet replacement is already pending");
    if (!native.compileStyleSheet) throw sheetError("Runtime CSS compilation is disabled in this host");
    replaceSheet(this, native.compileStyleSheet(String(text)));
  }

  replace(text) {
    const state = sheetData.get(this);
    if (state.replacing) return Promise.reject(sheetError("A stylesheet replacement is already pending"));
    const source = String(text);
    state.replacing = true;
    return Promise.resolve().then(() => {
      if (!native.compileStyleSheet) throw sheetError("Runtime CSS compilation is disabled in this host");
      replaceSheet(this, native.compileStyleSheet(source));
      return this;
    }).finally(() => { state.replacing = false; });
  }
}

function clearAdoptedSheets() {
  for (const entry of installedSheets) if (entry.live) native.styleSheet(3, entry.id, "");
  installedSheets = [];
}

function syncAdoptedSheets() {
  if (!rootNode) return;
  clearAdoptedSheets();
  const sheets = [...importedSheets.values()];
  for (const element of appliedStyles) if (element._styleSheet) sheets.push(element._styleSheet);
  sheets.push(...(adoptedLists.get(rootNode)?.values ?? []));
  for (const sheet of sheets) {
    if (nextSheet >= 0x80000000) throw new RangeError("Too many stylesheet adoptions");
    const entry = { sheet, id: nextSheet++, live: false };
    installedSheets.push(entry);
    const bytes = sheetData.get(sheet).bytes;
    if (bytes !== null) { native.styleSheet(1, entry.id, bytes); entry.live = true; }
  }
}

function validateSheets(values) {
  for (const sheet of values) if (!sheetData.has(sheet)) throw new TypeError("adoptedStyleSheets accepts constructed CSSStyleSheet objects");
  return values;
}

const sheetMutators = new Set(["copyWithin", "fill", "pop", "push", "reverse", "shift", "sort", "splice", "unshift"]);
function adoptedList(node) {
  let list = adoptedLists.get(node);
  if (list) return list;
  const values = [];
  const assign = next => {
    validateSheets(next);
    values.splice(0, values.length, ...next);
    if (rootNode === node) syncAdoptedSheets();
  };
  const numeric = key => typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key);
  const proxy = new Proxy(values, {
    get(target, key, receiver) {
      if (!sheetMutators.has(key)) return Reflect.get(target, key, receiver);
      return (...args) => {
        const next = values.slice();
        const result = Array.prototype[key].apply(next, args);
        assign(next);
        return result === next ? proxy : result;
      };
    },
    set(target, key, value) {
      if (key !== "length" && !numeric(key)) return Reflect.set(target, key, value);
      const next = values.slice();
      Reflect.set(next, key, value);
      assign(next);
      return true;
    },
    defineProperty(target, key, descriptor) {
      if (key !== "length" && !numeric(key)) return Reflect.defineProperty(target, key, descriptor);
      if (!Object.hasOwn(descriptor, "value") || descriptor.get || descriptor.set || descriptor.configurable === false || descriptor.writable === false) {
        throw new TypeError("adoptedStyleSheets entries must remain mutable values");
      }
      const next = values.slice();
      Reflect.set(next, key, descriptor.value);
      assign(next);
      return true;
    },
    deleteProperty(target, key) {
      if (!numeric(key)) return Reflect.deleteProperty(target, key);
      return Number(key) >= values.length;
    },
  });
  list = { values, proxy, assign };
  adoptedLists.set(node, list);
  return list;
}

/** Installs or replaces a CSS import compiled by the development build tool. */
export function updateStyleSheet(id, compiled) {
  const key = String(id);
  const previous = importedSheets.get(key);
  if (compiled === null) {
    if (importedSheets.delete(key)) syncAdoptedSheets();
  } else if (previous) {
    previous.replaceCompiled(compiled);
  } else {
    importedSheets.set(key, CSSStyleSheet.fromCompiled(compiled));
    syncAdoptedSheets();
  }
}

// What few nodes have, made on first use (see `Node`).
class NodeState {
  listeners = null;
  // The state looks by name.
  looks = null;
  flags = 0;
  // Kinds the node hears whatever its listeners: an input keeps its value and selection current.
  kept = 0;
  attributes = null;
  classList = null;
  dataset = null;
}

/** A node of the tree. Make one with `createBox`, `createText`, `createInput` or `createNode`. */
export class Node {
  // A node is a handle on the tree's node: it keeps only what the tree cannot answer at once
  // (its place among its siblings, its class, its base look), and puts the state few nodes
  // have (listeners, attributes, state looks) in one record made on first use. Every field
  // is a slot in every node, and a node of up to eight fits its object's own cell.
  // The base look: most nodes have the base alone.
  #base = null;
  #className = null;
  #rare = null;

  constructor(kind) {
    Object.defineProperty(this, "nodeId", { value: ++nextId, enumerable: true });
    // A text node's kind is its prototype's: one slot fewer in the most numerous node.
    if (kind !== "text") this.kind = kind;
    this.parentNode = null;
    // A node with no children shares one empty list, and gets its own at its first child.
    this.childNodes = NO_CHILDREN;
    nodes.set(this.nodeId, this);
    native.create(this.nodeId, KINDS[kind]);
  }

  #more() {
    return (this.#rare ??= new NodeState());
  }

  // The node's own child list, made on its first child.
  _ownChildren() {
    if (this.childNodes === NO_CHILDREN) this.childNodes = [];
    return this.childNodes;
  }

  get adoptedStyleSheets() { return adoptedList(this).proxy; }
  set adoptedStyleSheets(value) { adoptedList(this).assign(Array.from(value)); }

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

  /** Whether the node is in the mounted tree. */
  get isConnected() {
    return inDocument(this);
  }

  /** 1 for an element, 3 for text, 11 for a document fragment, as in the DOM. */
  get nodeType() {
    return 1;
  }

  /**
   * The element's tag: the HTML tag it was made with (see `createElement`), or for a tree
   * node the tag stylesheets match it by (`div` for a box).
   */
  get localName() {
    return this._tag ?? LOCAL_NAMES[this.kind] ?? "div";
  }

  set localName(value) {
    this._tag = String(value);
  }

  /** The tag in upper case for HTML elements, as in the DOM. */
  get tagName() {
    const name = this.localName;
    const namespace = this.namespaceURI;
    return namespace === undefined || namespace === null || namespace === "http://www.w3.org/1999/xhtml" ? name.toUpperCase() : name;
  }

  set tagName(_value) {}

  get nodeName() {
    return this.tagName;
  }

  hasChildNodes() {
    return this.childNodes.length > 0;
  }

  /** A copy with the same looks and attributes, and with `deep` copies of the children. */
  cloneNode(deep = false) {
    const copy = this._shallowClone();
    if (this.#base) this.#base._copyTo(copy.look("base"));
    const looks = this.#rare?.looks;
    for (const state in looks ?? {}) looks[state]._copyTo(copy.look(state));
    for (const [name, value] of this.#rare?.attributes ?? []) copy.setAttribute(name, value);
    if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    return copy;
  }

  _shallowClone() {
    if (this._tag !== undefined && this.constructor === Node) return createElement(this._tag);
    return new Node(this.kind);
  }

  /** Joins adjacent text children and drops empty ones, in the whole subtree. */
  normalize() {
    for (let node = this.firstChild; node; ) {
      if (node.nodeType !== 3) {
        node.normalize();
        node = node.nextSibling;
        continue;
      }
      let next = node.nextSibling;
      if (node.length === 0) {
        node.remove();
        node = next;
        continue;
      }
      let joined = "";
      for (let sibling = next; sibling?.nodeType === 3; sibling = sibling.nextSibling) joined += sibling.data;
      let length = node.length;
      node.replaceData(length, 0, joined);
      for (let current = next; current?.nodeType === 3; current = current.nextSibling) {
        const index = indexIn(current);
        eachLiveRange((range) => range._joined(current, node, length, index));
        length += current.length;
      }
      while (next?.nodeType === 3) {
        const after = next.nextSibling;
        next.remove();
        next = after;
      }
      node = next;
    }
  }

  /** Whether `other` is this node or inside it. */
  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  /** Inserts `child` before `before`, or last without it. A child already in the tree moves. */
  insertBefore(child, before = null) {
    if (child.contains(this)) throw domError("HierarchyRequestError", "a node cannot be inserted into itself or its own subtree");
    if (this.nodeType === 3) throw domError("HierarchyRequestError", "text has no children");
    if (before && before.parentNode !== this) throw domError("NotFoundError", "the node to insert before is not a child of this node");
    if (child.nodeType === 11) {
      for (const node of [...child.childNodes]) this.insertBefore(node, before);
      return child;
    }
    if (before === child) before = child.nextSibling;
    const old = child.parentNode;
    if (old) {
      const index = old.childNodes.indexOf(child);
      if (liveRanges.size) eachLiveRange((range) => range._removing(child, old, index));
      if (mutationObservers.size) childListRecord(old, null, child, old.childNodes[index - 1], old.childNodes[index + 1]);
      old.childNodes.splice(index, 1);
    }
    child.parentNode = this;
    if (liveRanges.size) {
      const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
      eachLiveRange((range) => range._inserted(this, index));
    }
    if (before) {
      this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
      native.insertBefore(this.nodeId, child.nodeId, before.nodeId);
    } else {
      this._ownChildren().push(child);
      native.append(this.nodeId, child.nodeId);
    }
    if (mutationObservers.size) childListRecord(this, child, null, child.previousSibling, before);
    if (styleElements.size) stylesChanged();
    return child;
  }

  appendChild(child) {
    return this.insertBefore(child, null);
  }

  /** Puts `node` where `child` is and detaches `child`. */
  replaceChild(node, child) {
    if (child.parentNode !== this) throw domError("NotFoundError", "the node to replace is not a child of this node");
    if (node === child) return child;
    let before = child.nextSibling;
    if (before === node) before = node.nextSibling;
    this.removeChild(child);
    this.insertBefore(node, before);
    return child;
  }

  /** Appends nodes, and strings as text nodes. */
  append(...children) {
    for (const child of children) this.insertBefore(typeof child === "string" ? createText(child) : child, null);
  }

  /** Detaches `child` and its subtree. It keeps its state and can be inserted again. */
  removeChild(child) {
    if (child.parentNode !== this) throw domError("NotFoundError", "the node to remove is not a child of this node");
    const index = this.childNodes.indexOf(child);
    if (liveRanges.size) eachLiveRange((range) => range._removing(child, this, index));
    if (mutationObservers.size) childListRecord(this, null, child, this.childNodes[index - 1], this.childNodes[index + 1]);
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    native.remove(child.nodeId);
    if (styleElements.size) stylesChanged();
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  /** Detaches and frees this node and its subtree. They cannot be used again. */
  destroy() {
    if (rootNode && this.contains(rootNode)) { clearAdoptedSheets(); rootNode = null; }
    const parent = this.parentNode;
    if (parent) {
      const index = parent.childNodes.indexOf(this);
      if (liveRanges.size) eachLiveRange((range) => range._removing(this, parent, index));
      if (mutationObservers.size) childListRecord(parent, null, this, parent.childNodes[index - 1], parent.childNodes[index + 1]);
      parent.childNodes.splice(index, 1);
      this.parentNode = null;
    }
    native.destroy(this.nodeId);
    forget(this);
    if (styleElements.size) stylesChanged();
  }

  /**
   * The base look. `node.style.set({ width: 120 })` sets properties,
   * `node.style = { ... }` replaces the look.
   */
  get style() {
    return this._tag === undefined ? this.look("base") : styleProxy(this.look("base"));
  }

  set style(properties) {
    if (typeof properties === "string") this.look("base").cssText = properties;
    else this.look("base").replace(properties);
  }

  /** The look the tree lays over the base in `state`: hover, active, focus, focusVisible, or
   * starting (what transitions start from when the node first shows, as `@starting-style`). */
  look(state) {
    if (state === "base") return (this.#base ??= new Look(this, 0));
    if (!(state in STATES)) throw new TypeError("the tree has no look '" + state + "'");
    const rare = this.#more();
    rare.looks ??= Object.create(null);
    return (rare.looks[state] ??= new Look(this, STATES[state]));
  }

  /**
   * Sets a tree attribute: tabIndex, disabled, label, testId, placeholder and so on. A node
   * with an `href` is a link: a click on it or inside it that no listener prevented opens
   * the address with `open`, as a click on an `<a>` follows it.
   *
   * `role` and `aria-*` work as in the DOM, spelled `aria-checked` or `ariaChecked`. A role
   * the tree does not know is ignored with a warning. Literal ARIA and data attributes
   * remain available to selectors even when they have no native accessibility mapping.
   */
  get id() { return this._elementId ?? ""; }
  set id(value) { this.setAttribute("id", String(value)); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(value) { this.setAttribute("class", String(value)); }
  get classList() { return this.#more().classList ??= new ClassList(this); }
  /** The `data-*` attributes by camelCase name, as `HTMLElement.dataset`. */
  get dataset() { return this.#more().dataset ??= datasetOf(this); }

  getAttribute(name) {
    name = String(name);
    if (name === "className" || name === "class") return this.#className;
    const aria = ariaName(name);
    return this.#rare?.attributes?.get(aria === null ? name : "aria-" + aria) ?? null;
  }

  hasAttribute(name) { return this.getAttribute(name) !== null; }

  getAttributeNames() {
    const names = this.#className === null ? [] : ["class"];
    for (const name of this.#rare?.attributes?.keys() ?? []) names.push(name);
    return names;
  }

  /** The children as HTML; setting it replaces them with nodes parsed from HTML. */
  get innerHTML() {
    let html = "";
    for (const child of this.childNodes) html += markupOf(child);
    return html;
  }

  set innerHTML(html) {
    for (const child of this.childNodes.slice()) child.destroy();
    parseHTML(String(html ?? ""), this);
  }

  get outerHTML() {
    return markupOf(this);
  }
  removeAttribute(name) { this.setAttribute(name, null); }

  setAttribute(name, value) {
    name = String(name);
    let text = value == null ? null : String(value);
    if (mutationObservers.size) attributeRecord(this, name, text);
    if (name === "className" || name === "class") {
      native.attribute(this.nodeId, "class", text);
      this.#className = text;
      return;
    }
    const aria = ariaName(name);
    if (aria !== null) name = "aria-" + aria;
    if (name === "role") {
      if (!native.attribute(this.nodeId, "role", text ?? "")) warnOnce("the tree has no role '" + text + "': it is ignored");
    } else if (name === "id") {
      this.#identify(text);
    } else if (aria !== null) {
      native.attribute(this.nodeId, name, text);
    } else if (name === "src") {
      // An image's address, as `<img src>`.
      if ("src" in this) this.src = text ?? "";
      else warnOnce("only an image has a src: it is ignored");
    } else if (name === "alt") {
      native.attribute(this.nodeId, "label", text ?? "");
    } else if (this._tag !== undefined && (name === "tabindex" || name === "tabIndex")) {
      this._keep("focus", "blur");
      native.attribute(this.nodeId, "tabIndex", text === null ? -2147483648 : Number(text));
    } else if (this._tag !== undefined && name === "style") {
      this.style.cssText = text ?? "";
    } else if (this._tag !== undefined && BOOLEAN_TREE_ATTRIBUTES.has(name)) {
      // An HTML boolean attribute is on whatever its text, `disabled=""` included.
      const on = value !== null && value !== undefined && value !== false;
      text = on ? "" : null;
      if (name === "checked" && "checked" in this) this.checked = on;
      else native.attribute(this.nodeId, name === "readonly" ? "readOnly" : name, on);
    } else if (this._tag !== undefined && name !== "href" && name !== "placeholder" && name !== "label") {
      // Any other HTML attribute is text the tree keeps for selectors (`[type=checkbox]`). One
      // the tree does not know (React 19's `precedence`, a library's own) stays on the element.
      try {
        native.attribute(this.nodeId, name, text);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
      }
    } else {
      if (name === "href") {
        this._href = text || null;
        this.#want(KIND_OF.get("click"));
      }
      native.attribute(this.nodeId, name,
        name === "lang" || name === "dir" || name.startsWith("data-") ? text : value);
    }
    if (text === null) this.#rare?.attributes?.delete(name);
    else (this.#more().attributes ??= new Map()).set(name, text);
    if (name === "contenteditable") this.#editableChanged();
  }

  // An editing host takes focus (as a tab stop, unless its tabindex says otherwise) and hears
  // the tree's edits, which `hostEdit` makes.
  #editableChanged() {
    if (editableValue(this) === 1) {
      this._keep("beforeinput", "focus", "blur");
      if (!this.hasAttribute("tabindex")) native.attribute(this.nodeId, "tabIndex", 0);
    } else if (!this.hasAttribute("tabindex") && !FOCUSABLE_TAGS.has(this._tag)) {
      native.attribute(this.nodeId, "tabIndex", -2147483648);
    }
  }

  /** "true", "false", "plaintext-only" or "inherit", from the `contenteditable` attribute. */
  get contentEditable() {
    const value = this.getAttribute("contenteditable");
    if (value === null) return "inherit";
    const lower = value.toLowerCase();
    return lower === "" || lower === "true" ? "true" : lower === "false" || lower === "plaintext-only" ? lower : "inherit";
  }

  set contentEditable(value) {
    const lower = String(value).toLowerCase();
    if (lower === "inherit") this.removeAttribute("contenteditable");
    else if (lower === "true" || lower === "false" || lower === "plaintext-only") this.setAttribute("contenteditable", lower);
    else throw domError("SyntaxError", "contentEditable takes true, false, plaintext-only or inherit");
  }

  /** Whether the user can edit the element: it is in an editing host (see `contentEditable`). */
  get isContentEditable() {
    return editingHostOf(this) !== null;
  }

  // The `id` other nodes' relations name this node by.
  #identify(id) {
    const old = this._elementId ?? "";
    if (old === (id ?? "") && this.getAttribute("id") === id) return;
    this._elementId = id || undefined;
    native.attribute(this.nodeId, "id", id);
  }

  // Tells the tree which events this node wants: its listeners', and clicks on a link.
  #want(kind) {
    const [wanted, bit] = this.#wanted(kind);
    const rare = this.#rare;
    const old = rare?.flags ?? 0;
    const flags = ((wanted ? old | bit : old & ~bit) | (rare?.kept ?? 0) | (this._extra ?? 0)) >>> 0;
    if (flags === old) return;
    this.#more().flags = flags;
    // A destroyed node has no tree node to tell: effect cleanups remove listeners after React frees it.
    if (nodes.has(this.nodeId)) native.listen(this.nodeId, flags);
  }

  // Whether this node's listeners (or link) want `kind`, and the flag bit that carries it.
  #wanted(kind) {
    const listeners = this.#rare?.listeners;
    const has = (type) => (listeners?.get(type)?.length ?? 0) > 0;
    if (SHARES_BIT(kind)) return [KINDS_OF_BIT(bitOf(kind)).some((each) => has(TYPES[each])), (1 << bitOf(kind)) >>> 0];
    const type = TYPES[kind];
    const wanted = has(type) || (MOUSE_OF.has(type) && has(MOUSE_OF.get(type))) || (kind === CLICK && (this._href || this._activate))
      || (kind === SELECTION_CHANGE && has("selectstart"));
    return [wanted, 1 << kind];
  }

  /** Listens again for every kind its listeners, kept kinds and `_extra` flags ask for. */
  _relisten() {
    let flags = (this.#rare?.kept ?? 0) | (this._extra ?? 0);
    for (let kind = 0; kind < TYPES.length; kind++) {
      const [wanted, bit] = this.#wanted(kind);
      if (wanted) flags |= bit;
    }
    flags >>>= 0;
    if (flags === (this.#rare?.flags ?? 0)) return;
    this.#more().flags = flags;
    if (nodes.has(this.nodeId)) native.listen(this.nodeId, flags);
  }

  _keep(...types) {
    const rare = this.#more();
    for (const type of types) rare.kept = (rare.kept | (1 << bitOf(KIND_OF.get(type)))) >>> 0;
    this.#want(KIND_OF.get(types[0]));
  }

  set tabIndex(value) {
    native.attribute(this.nodeId, "tabIndex", value);
  }

  set disabled(value) {
    native.attribute(this.nodeId, "disabled", value);
  }

  focus() {
    native.focus(this.nodeId);
  }

  /**
   * Sends the pointer's records here until it lifts, as DOM `setPointerCapture`. Throws
   * `NotFoundError` for a pointer that is not down. The tree moves the capture of the
   * primary pointer; another finger keeps sending to the node it went down on.
   */
  setPointerCapture(pointerId) {
    const pointer = pointers.get(pointerId);
    if (!pointer) throw domError("NotFoundError", `no active pointer with id ${pointerId}`);
    if (!pointer.buttons) return;
    pointer.capture = this;
    if (pointer.primary) native.capture(this.nodeId);
  }

  releasePointerCapture(pointerId) {
    const pointer = pointers.get(pointerId);
    if (!pointer) throw domError("NotFoundError", `no active pointer with id ${pointerId}`);
    if (pointer.capture !== this) return;
    pointer.capture = null;
    if (pointer.primary) native.capture(0);
  }

  hasPointerCapture(pointerId) {
    return pointers.get(pointerId)?.capture === this;
  }

  /** `scrollTo(x, y)` or `scrollTo({ left, top, behavior })`; `behavior: "smooth"` animates, and `auto` follows `scroll-behavior`. */
  scrollTo(x, y) {
    scrollNode(this.nodeId, x, y, 0);
  }

  scroll(x, y) {
    scrollNode(this.nodeId, x, y, 0);
  }

  /** As `scrollTo`, by an amount from where the node is scrolled. */
  scrollBy(x, y) {
    scrollNode(this.nodeId, x, y, 4);
  }

  /** The border box in window coordinates, after any pending layout, as on the web. */
  getBoundingClientRect() {
    return readRect(this.nodeId);
  }

  /** One rectangle per fragment (a wrapped inline box has one per line). */
  getClientRects() {
    return readRects(native.rects?.(this.nodeId) ?? 0);
  }

  get clientLeft() { return metric(this.nodeId, 0); }
  get clientTop() { return metric(this.nodeId, 1); }
  get clientWidth() { return metric(this.nodeId, 2); }
  get clientHeight() { return metric(this.nodeId, 3); }
  get scrollWidth() { return metric(this.nodeId, 4); }
  get scrollHeight() { return metric(this.nodeId, 5); }
  get scrollLeft() { return metric(this.nodeId, 6); }
  set scrollLeft(value) { scrollNode(this.nodeId, { left: value }, undefined, 0); }
  get scrollTop() { return metric(this.nodeId, 7); }
  set scrollTop(value) { scrollNode(this.nodeId, { top: value }, undefined, 0); }
  get offsetParent() { return nodes.get(metric(this.nodeId, 8)) ?? null; }
  get offsetLeft() { return metric(this.nodeId, 9); }
  get offsetTop() { return metric(this.nodeId, 10); }
  get offsetWidth() { return metric(this.nodeId, 11); }
  get offsetHeight() { return metric(this.nodeId, 12); }

  /**
   * Scrolls every scroll container around this node to show it, as on the web: `true` or
   * nothing aligns to the start, `false` to the end, or `{ block, inline, behavior }`.
   * `scroll-margin`, `scroll-padding` and `scroll-snap` apply.
   */
  scrollIntoView(options = true) {
    if (options === null || typeof options !== "object") {
      const top = options !== false;
      native.scrollIntoView?.(this.nodeId, top ? 0 : 2, 3, 0, 0);
      return;
    }
    native.scrollIntoView?.(this.nodeId, alignment(options.block, 0), alignment(options.inline, 3), BEHAVIORS[options.behavior] ?? 0, 0);
  }

  /** WebKit's: scrolls only containers that do not already show the node, centering it unless `center` is false. */
  scrollIntoViewIfNeeded(center = true) {
    const code = center ? 1 : 3;
    native.scrollIntoView?.(this.nodeId, code, code, 0, 1);
  }

  /** Whether this node matches CSS `selector`, by the same matcher as stylesheets. */
  matches(selector) {
    return queried(0, this, selector) === 1;
  }

  webkitMatchesSelector(selector) {
    return this.matches(selector);
  }

  /** This node or its nearest ancestor that matches `selector`, or null. */
  closest(selector) {
    return nodes.get(queried(1, this, selector)) ?? null;
  }

  /** The first descendant, in tree order, that matches `selector`, or null. */
  querySelector(selector) {
    return nodes.get(queried(2, this, selector)) ?? null;
  }

  /** Every descendant that matches `selector`, in tree order: a static list. */
  querySelectorAll(selector) {
    const ids = queried(3, this, selector);
    return typeof ids === "string" && ids !== "" ? ids.split(",").map((id) => nodes.get(Number(id))).filter(Boolean) : [];
  }

  /**
   * As on the web. `options` is `true` or `{ capture: true }` for the capture phase, and
   * `{ once: true }` for a listener that runs once. A type the tree has no event for is the
   * app's own, sent with `dispatchEvent`.
   */
  addEventListener(type, listener, options) {
    const signal = options?.signal;
    if (listener == null || signal?.aborted) return;
    const kind = KIND_OF.get(LISTENS_AS.get(type) ?? type);
    const capture = options === true || !!options?.capture;
    const listeners = (this.#more().listeners ??= new Map());
    let list = listeners.get(type);
    if (!list) listeners.set(type, (list = []));
    if (list.some((entry) => entry.listener === listener && entry.capture === capture)) return;
    list.push({ listener, capture, once: !!options?.once });
    if (kind !== undefined) this.#want(kind);
    signal?.addEventListener("abort", () => this.removeEventListener(type, listener, capture), { once: true });
  }

  removeEventListener(type, listener, options) {
    const list = this.#rare?.listeners?.get(type);
    if (!list) return;
    const capture = options === true || !!options?.capture;
    const index = list.findIndex((entry) => entry.listener === listener && entry.capture === capture);
    if (index < 0) return;
    list.splice(index, 1);
    const kind = KIND_OF.get(LISTENS_AS.get(type) ?? type);
    if (kind !== undefined) this.#want(kind);
  }

  /** Sends `event` (an `Event` or `CustomEvent`) through the tree from this node, as on the web. */
  dispatchEvent(event) {
    if (typeof event?.type !== "string") throw new TypeError("dispatchEvent takes an Event");
    return dispatchEvent(adopt(event, this));
  }

  /** Runs the capture or the bubble listeners of `event.type`. Used by the dispatcher. */
  _run(event, capture) {
    const list = this.#rare?.listeners?.get(event.type);
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
    this.replaceData(0, this.#data.length, value == null ? "" : value);
  }

  get nodeType() {
    return 3;
  }

  get nodeName() {
    return "#text";
  }

  get nodeValue() {
    return this.#data;
  }

  set nodeValue(value) {
    this.data = value;
  }

  get textContent() {
    return this.#data;
  }

  set textContent(value) {
    this.data = value;
  }

  get length() {
    return this.#data.length;
  }

  _shallowClone() {
    return new Text(this.#data);
  }

  substringData(offset, count) {
    offset = offset >>> 0;
    if (offset > this.#data.length) throw domError("IndexSizeError", "the offset is past the end of the text");
    return this.#data.substring(offset, offset + (count >>> 0));
  }

  appendData(data) {
    this.replaceData(this.#data.length, 0, data);
  }

  insertData(offset, data) {
    this.replaceData(offset, 0, data);
  }

  deleteData(offset, count) {
    this.replaceData(offset, count, "");
  }

  replaceData(offset, count, data) {
    offset = offset >>> 0;
    count = count >>> 0;
    data = String(data);
    const old = this.#data;
    if (offset > old.length) throw domError("IndexSizeError", "the offset is past the end of the text");
    if (offset + count > old.length) count = old.length - offset;
    if (liveRanges.size) eachLiveRange((range) => range._replaced(this, offset, count, data.length));
    const value = old.slice(0, offset) + data + old.slice(offset + count);
    if (value === old && value !== "") return;
    this.#data = value;
    native.setText(this.nodeId, value);
    if (mutationObservers.size) characterDataRecord(this, old);
    if (this._svgText) svgChanged(this);
    if (styleElements.size && this.parentNode instanceof StyleElement) stylesChanged();
  }

  /** Splits at `offset`: this keeps the text before it, and a new next sibling the rest. */
  splitText(offset) {
    offset = offset >>> 0;
    const length = this.#data.length;
    if (offset > length) throw domError("IndexSizeError", "the offset is past the end of the text");
    const rest = new Text(this.#data.slice(offset));
    const parent = this.parentNode;
    if (parent) {
      parent.insertBefore(rest, this.nextSibling);
      const index = indexIn(this);
      if (liveRanges.size) eachLiveRange((range) => range._split(this, rest, offset, parent, index));
    }
    this.replaceData(offset, length - offset, "");
    return rest;
  }
}

Object.defineProperty(Text.prototype, "kind", { value: "text", writable: true, configurable: true });

// `<br>`: to the tree a text node of U+2028, which breaks the line whatever `white-space`
// says and gives an empty block its line, and to scripts an element with no children. Its
// attributes stay here: the tree's text nodes have none.
const LINE_BREAK = "\u2028";

export class LineBreak extends Node {
  #attributes = new Map();

  constructor() {
    super("text");
    this.kind = "text";
    this._tag = "br";
    native.setText(this.nodeId, LINE_BREAK);
  }

  get nodeType() { return 1; }
  get textContent() { return ""; }
  set textContent(_value) {}
  getAttribute(name) { return this.#attributes.get(String(name).toLowerCase()) ?? null; }
  hasAttribute(name) { return this.#attributes.has(String(name).toLowerCase()); }
  getAttributeNames() { return [...this.#attributes.keys()]; }
  removeAttribute(name) { this.setAttribute(name, null); }

  setAttribute(name, value) {
    name = String(name).toLowerCase();
    if (name === "classname") name = "class";
    if (value == null) this.#attributes.delete(name);
    else this.#attributes.set(name, String(value));
  }

  get className() { return this.getAttribute("class") ?? ""; }
  set className(value) { this.setAttribute("class", value); }
  appendChild() { throw domError("HierarchyRequestError", "a br has no children"); }
  insertBefore() { throw domError("HierarchyRequestError", "a br has no children"); }

  _shallowClone() {
    const copy = new LineBreak();
    for (const [name, value] of this.#attributes) copy.setAttribute(name, value);
    return copy;
  }

  cloneNode() { return this._shallowClone(); }
}

// A point the tree has in a `<br>` (its text node), as a point in the br's parent.
function fromTreePoint(node, offset) {
  if (!(node instanceof LineBreak) || !node.parentNode) return [node, offset];
  return [node.parentNode, indexIn(node) + (offset > 0 ? 1 : 0)];
}

/**
 * An editable text field. `value` follows what the user types. Selection offsets are UTF-16
 * string indices, as on the web; the tree counts UTF-8 bytes, converted here.
 */
export class Input extends Node {
  #value = "";
  #start = 0;
  #end = 0;
  #direction = "forward";

  constructor() {
    super("input");
    this._keep("input", "selectionchange");
  }

  /** The text the selection offsets index into. */
  _text() {
    return this.#value;
  }

  _shallowClone() {
    const copy = new this.constructor();
    copy.value = this.#value;
    return copy;
  }

  get value() {
    return this.#value;
  }

  set value(value) {
    value = String(value);
    if (value === this.#value) return;
    this.#value = value;
    native.setText(this.nodeId, value);
    this.#start = this.#end = value.length;
    this.#direction = "forward";
  }

  get selectionStart() {
    return this.#start;
  }

  set selectionStart(value) {
    const start = clampIndex(value, this._text().length);
    this.setSelectionRange(start, Math.max(start, this.#end), this.#direction);
  }

  get selectionEnd() {
    return this.#end;
  }

  set selectionEnd(value) {
    this.setSelectionRange(this.#start, clampIndex(value, this._text().length), this.#direction);
  }

  get selectionDirection() {
    return this.#direction;
  }

  set selectionDirection(value) {
    this.setSelectionRange(this.#start, this.#end, value);
  }

  /** Selects `start` to `end`; with `direction` "backward" the caret sits at `start`. */
  setSelectionRange(start, end, direction = "none") {
    const text = this._text();
    end = clampIndex(end, text.length);
    start = Math.min(clampIndex(start, text.length), end);
    const backward = direction === "backward";
    this.#start = start;
    this.#end = end;
    this.#direction = backward ? "backward" : "forward";
    const anchor = byteOf(text, backward ? end : start);
    const focus = byteOf(text, backward ? start : end);
    native.select(this.nodeId, anchor, focus);
  }

  /** Selects the whole value. */
  select() {
    this.setSelectionRange(0, this._text().length);
  }

  /**
   * Replaces `start` to `end` (the selection by default) with `replacement`. `selectionMode`
   * is "select", "start", "end" or "preserve", as on the web.
   */
  setRangeText(replacement, start, end, selectionMode = "preserve") {
    replacement = String(replacement);
    const text = this._text();
    if (start === undefined) {
      start = this.#start;
      end = this.#end;
    } else if (end === undefined) {
      throw new TypeError("setRangeText needs both start and end");
    } else if (Number(start) > Number(end)) {
      throw domError("IndexSizeError", "setRangeText: start is after end");
    }
    start = clampIndex(start, text.length);
    end = clampIndex(end, text.length);
    let selectionStart = this.#start;
    let selectionEnd = this.#end;
    const delta = replacement.length - (end - start);
    const newEnd = start + replacement.length;
    if (selectionMode === "select") {
      selectionStart = start;
      selectionEnd = newEnd;
    } else if (selectionMode === "start") {
      selectionStart = selectionEnd = start;
    } else if (selectionMode === "end") {
      selectionStart = selectionEnd = newEnd;
    } else {
      if (selectionStart > end) selectionStart += delta;
      else if (selectionStart > start) selectionStart = start;
      if (selectionEnd > end) selectionEnd += delta;
      else if (selectionEnd > start) selectionEnd = newEnd;
    }
    const direction = this.#direction;
    this._replace(start, end, replacement);
    this.setSelectionRange(selectionStart, selectionEnd, direction);
  }

  _replace(start, end, replacement) {
    const text = this.#value;
    this.value = text.slice(0, start) + replacement + text.slice(end);
  }

  // From the tree: the value and selection in UTF-8 bytes.
  _changed(value, anchor, focus) {
    this.#value = value;
    this.#take(byteIndex(value, anchor), byteIndex(value, focus));
  }

  _selected(start, end) {
    const text = this._text();
    this.#take(byteIndex(text, start), byteIndex(text, end));
  }

  // The tree reports the low and high offsets only, so a selection it changed reads forward
  // unless it is the one set here.
  #take(a, b) {
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (start === this.#start && end === this.#end) return;
    this.#start = start;
    this.#end = end;
    this.#direction = "forward";
  }
}

function clampIndex(value, length) {
  const number = Math.trunc(Number(value)) || 0;
  return Math.min(Math.max(number, 0), length);
}

// A UTF-8 offset from the tree as a string index; NaN and missing read as 0.
function byteIndex(text, byte) {
  return indexOf(text, Number(byte) || 0);
}

// Inline SVG markup as icon resources: identical markup shares one, freed when no `<svg>`
// shows it. The ids start high, clear of resources a host or a URL table numbers from 1.
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

// Addresses as image resources, shared and freed as markup is. The tree keeps a load state per
// number, so these count from 1. The loader tells an SVG file from a bitmap by itself.
const ADDRESSES = new Map();
let nextAddress = 1;

function holdAddress(url) {
  let entry = ADDRESSES.get(url);
  if (!entry) {
    entry = { id: nextAddress++, count: 0 };
    ADDRESSES.set(url, entry);
    native.load(entry.id, url, false);
  }
  entry.count++;
  return entry.id;
}

function dropAddress(url) {
  const entry = ADDRESSES.get(url);
  if (entry && --entry.count === 0) {
    ADDRESSES.delete(url);
    native.release(entry.id);
  }
}

/**
 * An image, as an `<img>`: `src` is its address, a `data:` URL (base64 or percent-encoded),
 * a file or `http(s):`. An SVG file draws as an inline `<svg>` does. It hears `load` and
 * `error` when the address loads or fails.
 */
export class Image extends Node {
  #src = "";

  constructor(src = "") {
    super("image");
    this.src = src;
  }

  get src() {
    return this.#src;
  }

  set src(url) {
    url = url == null ? "" : String(url);
    if (url === this.#src) return;
    if (this.#src) dropAddress(this.#src);
    this.#src = url;
    native.source(this.nodeId, url ? holdAddress(url) : 0);
  }

  _forget() {
    if (this.#src) dropAddress(this.#src);
    this.#src = "";
  }

  _shallowClone() {
    return new Image(this.#src);
  }
}

/**
 * A canvas the application draws with WebGPU or Canvas 2D, as a `<canvas>`: `width` and
 * `height` are the size of what is drawn in pixels (300 by 150 at first), `getContext("webgpu")`
 * gives a `GPUCanvasContext` and `getContext("2d")` a `CanvasRenderingContext2D`. The node lays out as an image of that size does: its style can
 * stretch it, and `objectFit` says how the drawing fits. Drawing happens on a GPU device of
 * the application's own, so a canvas that is slow to draw does not slow the rest of the window.
 */
export class Canvas extends Node {
  #width = 300;
  #height = 150;
  #context = null;
  #kind = "";

  constructor() {
    super("canvas");
  }

  get width() {
    return this.#width;
  }

  set width(value) {
    value = Math.max(0, Number(value) | 0);
    if (value === this.#width) return;
    this.#width = value;
    this.#context?._resized();
  }

  get height() {
    return this.#height;
  }

  set height(value) {
    value = Math.max(0, Number(value) | 0);
    if (value === this.#height) return;
    this.#height = value;
    this.#context?._resized();
  }

  /**
   * The canvas's `GPUCanvasContext` for "webgpu" or `CanvasRenderingContext2D` for "2d"; null
   * for any other kind, or for a kind other than the one the canvas already has.
   */
  getContext(kind, options) {
    if (kind !== "webgpu" && kind !== "2d") return null;
    if (this.#context) return this.#kind === kind ? this.#context : null;
    const api = kind === "2d" ? native.canvas2dLoad?.() : native.gpuLoad?.();
    if (!api) return null;
    this.#kind = kind;
    return (this.#context = api.context(this, options));
  }

  setAttribute(name, value) {
    if (name === "width") this.width = value == null ? 300 : value;
    else if (name === "height") this.height = value == null ? 150 : value;
    else super.setAttribute(name, value);
  }

  getAttribute(name) {
    if (name === "width") return String(this.#width);
    if (name === "height") return String(this.#height);
    return super.getAttribute(name);
  }

  _shallowClone() {
    const copy = new Canvas();
    copy.width = this.#width;
    copy.height = this.#height;
    return copy;
  }
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// SVG attribute names that are camel case in SVG itself. Any other name with a capital letter
// is a React-style spelling of a hyphenated one (`strokeWidth` for `stroke-width`).
const SVG_CAMEL = new Set([
  "viewBox", "preserveAspectRatio", "gradientUnits", "gradientTransform", "patternUnits",
  "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits", "maskContentUnits",
  "markerUnits", "markerWidth", "markerHeight", "refX", "refY", "spreadMethod", "stdDeviation",
  "textLength", "lengthAdjust", "startOffset", "pathLength", "baseFrequency", "numOctaves",
  "filterUnits", "primitiveUnits", "kernelMatrix", "kernelUnitLength", "tableValues",
  "surfaceScale", "specularConstant", "specularExponent", "diffuseConstant", "limitingConeAngle",
  "pointsAtX", "pointsAtY", "pointsAtZ", "edgeMode", "targetX", "targetY", "xChannelSelector",
  "yChannelSelector", "attributeName", "attributeType", "calcMode", "keyTimes", "keySplines",
  "keyPoints", "repeatCount", "repeatDur", "systemLanguage", "requiredFeatures", "zoomAndPan",
  "glyphRef", "stitchTiles", "viewTarget", "contentScriptType", "contentStyleType",
]);
const SVG_NAMES = new Map([
  ["className", "class"], ["htmlFor", "for"], ["xlinkHref", "xlink:href"], ["xlinkTitle", "xlink:title"],
  ["xmlSpace", "xml:space"], ["xmlLang", "xml:lang"], ["xmlnsXlink", "xmlns:xlink"],
]);

function svgName(name) {
  name = String(name);
  const named = SVG_NAMES.get(name);
  if (named) return named;
  if (SVG_CAMEL.has(name) || !/[A-Z]/.test(name)) return name;
  return name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
}

function escaped(text, attribute) {
  text = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return attribute ? text.replace(/"/g, "&quot;") : text;
}

// The svg roots whose markup changed, drawn again once, before the host applies the mutations.
const changedSvgs = new Set();

function drawSvgs() {
  for (const svg of changedSvgs) svg._draw();
  changedSvgs.clear();
}

/** The element of `node` in an `<svg>` subtree: its text, or its element. */
function svgOwner(node) {
  for (let at = node; at; at = at.parentNode) if (at instanceof Svg) return at;
  return null;
}

function svgChanged(node) {
  const svg = svgOwner(node);
  if (!svg || changedSvgs.has(svg)) return;
  if (changedSvgs.size === 0) queueMicrotask(drawSvgs);
  changedSvgs.add(svg);
}

// A live svg: after its first drawing, an `<svg>` whose elements change sends each change to
// the tree as it happens (`svgInsert`, `svgAttribute`, `svgRemove`), and the tree draws its
// shapes as paths, so a frame of an animation costs what it changes. This needs content the
// tree's live svg draws; anything else keeps the svg drawn as markup.
const LIVE_TAGS = new Set([
  "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "clipPath",
  "linearGradient", "radialGradient", "stop", "title", "desc", "metadata",
]);
const QUIET_TAGS = new Set(["title", "desc", "metadata"]);
const UNLIVE_ATTRIBUTES = new Set(["mask", "filter", "marker", "marker-start", "marker-mid", "marker-end"]);
const UNLIVE_STYLE = /(^|;)\s*(mask|filter|marker)[\w-]*\s*:/;

function liveAttribute(name, text) {
  return !UNLIVE_ATTRIBUTES.has(name) && !(name === "style" && UNLIVE_STYLE.test(text));
}

/** Whether the tree's live svg can draw `child` and what is in it. */
function liveable(child, quiet = false) {
  if (!(child instanceof SvgElement)) return quiet;
  if (!LIVE_TAGS.has(child.localName)) return false;
  for (const [name, value] of child._attributes()) if (!liveAttribute(name, value)) return false;
  const inner = quiet || QUIET_TAGS.has(child.localName);
  for (const grandchild of child.childNodes) if (!liveable(grandchild, inner)) return false;
  return true;
}

/** The live svg `node` is in, or null. */
function liveOwner(node) {
  const svg = svgOwner(node);
  return svg?._live ? svg : null;
}

function svgStyle(value) {
  if (typeof value !== "object" || value === null) return String(value);
  let css = "";
  for (const name of Object.keys(value)) {
    const part = value[name];
    if (part === null || part === undefined || part === "") continue;
    css += cssName(name) + ":" + (typeof part === "number" && !UNITLESS.has(name) ? part + "px" : part) + ";";
  }
  return css;
}

// Elements of any svg by id, for `<use href="#id">` in another svg: icon sprites define
// symbols in one hidden svg and every icon uses them.
const SVG_IDS = new Map();

function nameSvgElement(element, old, id) {
  if (old !== undefined && SVG_IDS.get(old)?.deref() === element) SVG_IDS.delete(old);
  if (id !== undefined) SVG_IDS.set(id, new WeakRef(element));
}

const REFERENCE = /href="#([^"]+)"/g;

// The tree draws each svg as a document of its own, so the elements its `href="#id"`s name
// in other svgs go into its markup, in a `<defs>`.
function withReferences(markup) {
  if (!markup.includes('href="#')) return markup;
  const own = new Set();
  for (const found of markup.matchAll(/\sid="([^"]+)"/g)) own.add(found[1]);
  let defs = "";
  let pending = markup;
  while (pending) {
    let next = "";
    for (const found of pending.matchAll(REFERENCE)) {
      const id = found[1];
      if (own.has(id)) continue;
      own.add(id);
      const element = SVG_IDS.get(id)?.deref();
      if (!element || element.getAttribute("id") !== id) continue;
      const added = element._markup();
      defs += added;
      next += added;
    }
    pending = next;
  }
  if (!defs) return markup;
  return markup.slice(0, markup.lastIndexOf("</svg>")) + "<defs>" + defs + "</defs></svg>";
}

// The children of an element of an `<svg>`: the markup they write, and how they move.
const svgChildren = {
  insertBefore(child, before = null) {
    if (before && before.parentNode !== this) throw new Error("the node to insert before is not a child of this node");
    if (before === child) return child;
    for (let at = this; at; at = at.parentNode) if (at === child) throw new Error("a node cannot be inserted into itself or its own subtree");
    const old = child.parentNode;
    const listening = shapeListeners(child);
    if (old) {
      liveOwner(old)?._removed(child);
      svgChanged(old);
      old.childNodes.splice(old.childNodes.indexOf(child), 1);
      if (listening) svgOwner(old)?._listenShapes();
    }
    child.parentNode = this;
    if (before) this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    else (this.childNodes === NO_CHILDREN ? (this.childNodes = []) : this.childNodes).push(child);
    if (child instanceof Text) child._svgText = true;
    liveOwner(this)?._inserted(child, this, before);
    svgChanged(this);
    if (listening) svgOwner(this)?._listenShapes();
    return child;
  },
  appendChild(child) {
    return this.insertBefore(child, null);
  },
  append(...children) {
    for (const child of children) this.insertBefore(typeof child === "string" ? new SvgText(child) : child, null);
  },
  removeChild(child) {
    if (child.parentNode !== this) throw new Error("the node to remove is not a child of this node");
    liveOwner(this)?._removed(child);
    svgChanged(this);
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    if (shapeListeners(child)) svgOwner(this)?._listenShapes();
    return child;
  },
  get textContent() {
    let text = "";
    for (const child of this.childNodes) text += child.textContent ?? child.data ?? "";
    return text;
  },
  set textContent(value) {
    for (const child of this.childNodes.slice()) this.removeChild(child);
    if (value !== null && value !== undefined && value !== "") this.insertBefore(new SvgText(String(value)), null);
  },
  _markupOf(children) {
    let markup = "";
    for (const child of children) {
      if (child instanceof SvgElement) markup += child._markup();
      else markup += escaped(child.data ?? "", false);
    }
    return markup;
  },
};

// `element` and what is inside it as `__ui.svgMeasure` reads them (ui-tree `live_svg.measure`):
// records split by U+001E, each the parent's record number, the tag, then name/value pairs.
function svgPacked(element) {
  const records = [];
  const visit = (at, parent) => {
    const number = records.length + 1;
    let record = parent + "\x1f" + at.localName;
    for (const [name, value] of at._attributes()) record += "\x1f" + name + "\x1f" + value;
    records.push(record);
    for (const child of at.childNodes) if (child instanceof SvgElement) visit(child, number);
  };
  visit(element, 0);
  return records.join("\x1e");
}

function svgBox(element) {
  const [x, y, width, height] = native.svgMeasure(0, svgPacked(element), 0).split(" ").map(Number);
  const Rect = globalThis.DOMRect;
  return Rect ? new Rect(x, y, width, height) : { x, y, width, height };
}

// Whether `element` or an element inside it has listeners.
function shapeListeners(element) {
  if (!(element instanceof SvgElement)) return false;
  for (const list of element._listeners?.values() ?? []) if (list.length > 0) return true;
  return element.childNodes.some(shapeListeners);
}

function quietAncestor(element) {
  for (let at = element; at && at instanceof SvgElement; at = at.parentNode) if (QUIET_TAGS.has(at.localName)) return true;
  return false;
}

/** The declarations of `element`'s `style` attribute, read and written as properties. */
function svgDeclarations(element) {
  const read = () => {
    const map = new Map();
    for (const part of (element.getAttribute("style") ?? "").split(";")) {
      const colon = part.indexOf(":");
      if (colon > 0) map.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
    return map;
  };
  const write = (map) => {
    let css = "";
    for (const [name, value] of map) css += name + ": " + value + ";";
    if (css) element.setAttribute("style", css);
    else element.removeAttribute("style");
  };
  const set = (name, value) => {
    const map = read();
    if (value === null || value === undefined || value === "") map.delete(name);
    else map.set(name, String(value));
    write(map);
  };
  const methods = {
    setProperty: (name, value) => set(String(name), value),
    removeProperty: (name) => {
      const old = read().get(String(name)) ?? "";
      set(String(name), null);
      return old;
    },
    getPropertyValue: (name) => read().get(String(name)) ?? "",
  };
  return new Proxy(methods, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (key === "cssText") return element.getAttribute("style") ?? "";
      return read().get(cssName(key)) ?? "";
    },
    set(target, key, value) {
      if (key === "cssText") element.setAttribute("style", String(value));
      else if (typeof key === "string") set(cssName(key), value);
      return true;
    },
  });
}

/** Text in an `<svg>`: its `<text>` and `<title>` contents. */
export class SvgText {
  #data;

  constructor(data = "") {
    this.#data = String(data);
    this.parentNode = null;
    this.childNodes = NO_CHILDREN;
  }

  get data() {
    return this.#data;
  }

  set data(value) {
    value = String(value);
    if (value === this.#data) return;
    this.#data = value;
    const live = liveOwner(this);
    if (live && !QUIET_TAGS.has(this.parentNode?.localName)) live._leave();
    svgChanged(this);
  }

  get textContent() {
    return this.#data;
  }

  set textContent(value) {
    this.data = value;
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }

  get previousSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) - 1] ?? null : null;
  }

  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  destroy() {
    this.remove();
  }
}

/**
 * An element inside an `<svg>`: `path`, `circle`, `g`, `linearGradient` and the rest. It is
 * no node of the tree: it is markup its `Svg` root draws. Its attributes take SVG's names or
 * React's spellings (`strokeWidth`, `xlinkHref`).
 */
export class SvgElement {
  #attributes = new Map();

  constructor(tag) {
    this.localName = String(tag);
    this.tagName = this.localName;
    this.namespaceURI = SVG_NAMESPACE;
    this.parentNode = null;
    this.childNodes = [];
  }

  getAttribute(name) {
    return this.#attributes.get(svgName(name)) ?? null;
  }

  hasAttribute(name) {
    return this.#attributes.has(svgName(name));
  }

  getAttributeNames() {
    return [...this.#attributes.keys()];
  }

  get dataset() {
    return (this._dataset ??= datasetOf(this));
  }

  setAttribute(name, value) {
    name = svgName(name);
    if (value === null || value === undefined || value === false) {
      this.removeAttribute(name);
      return;
    }
    const text = name === "style" ? svgStyle(value) : String(value);
    if (this.#attributes.get(name) === text) return;
    if (name === "id") nameSvgElement(this, this.#attributes.get(name), text);
    this.#attributes.set(name, text);
    this._written(name, text);
  }

  removeAttribute(name) {
    name = svgName(name);
    if (name === "id" && this.#attributes.has(name)) nameSvgElement(this, this.#attributes.get(name), undefined);
    if (this.#attributes.delete(name)) this._written(name, null);
  }

  setAttributeNS(namespace, name, value) {
    this.setAttribute(name, value);
  }

  getAttributeNS(namespace, name) {
    return this.getAttribute(name);
  }

  removeAttributeNS(namespace, name) {
    this.removeAttribute(name);
  }

  /** The element's `style` attribute as a declaration object: `style.display = "none"`. */
  get style() {
    return this._style ??= svgDeclarations(this);
  }

  _attributes() {
    return this.#attributes;
  }

  _written(name, text) {
    const live = liveOwner(this);
    if (!live) svgChanged(this);
    else if (text !== null && !liveAttribute(name, text)) live._leave();
    else native.svgAttribute(live.nodeId, this._n, name, text);
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

  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  /** Takes the element out of its `<svg>`. It is plain markup, so nothing else is freed. */
  destroy() {
    this.remove();
  }

  /**
   * Hears pointer events on this element's shapes, as on the web: its `<svg>` turns live (see
   * `Svg`) and the tree tells which shape is under the pointer.
   */
  addEventListener(type, listener, options) {
    if (listener == null) return;
    const capture = options === true || !!options?.capture;
    this._listeners ??= new Map();
    let list = this._listeners.get(type);
    if (!list) this._listeners.set(type, (list = []));
    if (list.some((entry) => entry.listener === listener && entry.capture === capture)) return;
    list.push({ listener, capture, once: !!options?.once });
    svgOwner(this)?._listenShapes();
  }

  removeEventListener(type, listener, options) {
    const list = this._listeners?.get(type);
    if (!list) return;
    const capture = options === true || !!options?.capture;
    const index = list.findIndex((entry) => entry.listener === listener && entry.capture === capture);
    if (index < 0) return;
    list.splice(index, 1);
    svgOwner(this)?._listenShapes();
  }

  dispatchEvent(event) {
    if (typeof event?.type !== "string") throw new TypeError("dispatchEvent takes an Event");
    return dispatchEvent(adopt(event, this));
  }

  /** The box of its geometry in its own user space: a shape's fill, a group's children. */
  getBBox() {
    return svgBox(this);
  }

  /** The length of a shape's outline in user units. */
  getTotalLength() {
    return Number(native.svgMeasure(1, svgPacked(this), 0));
  }

  /** The point `distance` along a shape's outline, clamped to its ends. */
  getPointAtLength(distance) {
    const [x, y] = native.svgMeasure(2, svgPacked(this), Number(distance) || 0).split(" ").map(Number);
    return { x, y };
  }

  _run(event, capture) {
    const list = this._listeners?.get(event.type);
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

  _markup() {
    let markup = "<" + this.localName;
    for (const [name, value] of this.#attributes) markup += " " + name + '="' + escaped(value, true) + '"';
    if (this.childNodes.length === 0) return markup + "/>";
    return markup + ">" + svgChildren._markupOf(this.childNodes) + "</" + this.localName + ">";
  }
}

for (const name of ["insertBefore", "appendChild", "append", "removeChild"]) SvgElement.prototype[name] = svgChildren[name];
Object.defineProperty(SvgElement.prototype, "textContent", Object.getOwnPropertyDescriptor(svgChildren, "textContent"));

// Attributes of an `<svg>` root the tree has: they go to its node. Every other one is markup.
function treeAttribute(name) {
  return name === "class" || name === "className" || name === "id" || name === "role" || name === "tabIndex"
    || name === "tabindex" || name === "testId" || name === "label" || name === "cursor" || name === "transition"
    || name === "inert" || name === "disabled" || name === "element" || name === "lang" || name === "dir"
    || name.startsWith("data-") || ariaName(name) !== null;
}

/**
 * An inline `<svg>`, as the web has it: its children are `SvgElement`s and `SvgText`s, and
 * the tree draws the markup they make as an icon. Its look, class, events and accessibility
 * are the node's; `viewBox`, `fill`, `width` and the other SVG attributes are markup.
 * Changes are drawn once, before the host applies the batch.
 */
export class Svg extends Node {
  #attributes = new Map();
  #markup = "";
  // Live: element numbers in use, and freed ones to use again.
  _live = false;
  _count = 0;
  _free = [];

  constructor() {
    // The tree's node for drawn SVG markup is an icon; to code it is an `svg`.
    super("icon");
    this.kind = "svg";
    this.namespaceURI = SVG_NAMESPACE;
    // Page selectors such as `button svg` and preflight's `svg { display: block }` name it.
    native.attribute(this.nodeId, "element", "svg");
    svgChanged(this);
  }

  _shallowClone() {
    return new Svg();
  }

  getAttribute(name) {
    return treeAttribute(String(name)) ? super.getAttribute(name) : this.#attributes.get(svgName(name)) ?? null;
  }

  setAttribute(name, value) {
    name = String(name);
    if (treeAttribute(name)) {
      super.setAttribute(name === "tabindex" ? "tabIndex" : name, value);
      return;
    }
    name = svgName(name);
    if (name === "xmlns") return;
    if (value === null || value === undefined || value === false || value === "") {
      this.removeAttribute(name);
      return;
    }
    const text = name === "style" ? svgStyle(value) : String(value);
    if (this.#attributes.get(name) === text) return;
    this.#attributes.set(name, text);
    this._written(name, text);
  }

  removeAttribute(name) {
    name = String(name);
    if (treeAttribute(name)) super.removeAttribute(name);
    else if (this.#attributes.delete(svgName(name))) this._written(svgName(name), null);
  }

  setAttributeNS(namespace, name, value) {
    this.setAttribute(name, value);
  }

  getAttributeNS(namespace, name) {
    return this.getAttribute(name);
  }

  /** The box of what it draws, in its user space (inside `viewBox`). */
  getBBox() {
    return svgBox(this);
  }

  _attributes() {
    return this.#attributes;
  }

  _written(name, text) {
    if (!this._live) svgChanged(this);
    else if (text !== null && !liveAttribute(name, text)) this._leave();
    else native.svgAttribute(this.nodeId, 0, name, text);
  }

  /** Sends the elements to the tree as a live svg, once its markup was drawn and changed. */
  _goLive() {
    this._forget();
    this._live = true;
    for (const [name, value] of this.#attributes) native.svgAttribute(this.nodeId, 0, name, value);
    for (const child of this.childNodes) this._inserted(child, this, null);
  }

  /** Back to markup: content the live svg does not draw came in. */
  _leave() {
    if (!this._live) return;
    this._live = false;
    this._count = 0;
    this._free = [];
    native.svgRemove(this.nodeId, 0);
    svgChanged(this);
  }

  _inserted(child, parent, before) {
    if (!(child instanceof SvgElement)) {
      if (!QUIET_TAGS.has(parent.localName) && !(parent !== this && svgOwner(parent) && quietAncestor(parent))) this._leave();
      return;
    }
    if (!liveable(child, quietAncestor(parent))) {
      this._leave();
      return;
    }
    this._send(child, parent === this ? 0 : parent._n, before instanceof SvgElement ? before._n : -1);
  }

  _send(element, parent, before) {
    element._n = this._free.pop() ?? ++this._count;
    native.svgInsert(this.nodeId, element._n, element.localName, parent, before);
    for (const [name, value] of element._attributes()) native.svgAttribute(this.nodeId, element._n, name, value);
    for (const child of element.childNodes) if (child instanceof SvgElement) this._send(child, element._n, -1);
  }

  _removed(child) {
    if (!(child instanceof SvgElement) || !child._n) return;
    native.svgRemove(this.nodeId, child._n);
    const free = (element) => {
      if (element._n) this._free.push(element._n);
      element._n = 0;
      for (const grandchild of element.childNodes) if (grandchild instanceof SvgElement) free(grandchild);
    };
    free(child);
  }

  /** The markup the tree draws, as `outerHTML` gives it. */
  get outerHTML() {
    let markup = '<svg xmlns="' + SVG_NAMESPACE + '"';
    const children = svgChildren._markupOf(this.childNodes);
    let xlink = this.#attributes.has("xmlns:xlink");
    for (const [name, value] of this.#attributes) {
      markup += " " + name + '="' + escaped(value, true) + '"';
    }
    if (!xlink && children.includes("xlink:")) markup += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    return markup + ">" + children + "</svg>";
  }

  _draw() {
    if (!nodes.has(this.nodeId) || this._live) return;
    if (this._extra && this.childNodes.every((child) => liveable(child))) {
      this._goLive();
      return;
    }
    const markup = withReferences(this.outerHTML);
    if (markup === this.#markup) return;
    if (this.#markup && this.childNodes.every((child) => liveable(child))) {
      this._goLive();
      return;
    }
    this._forget();
    this.#markup = markup;
    native.source(this.nodeId, holdIcon(markup));
  }

  _forget() {
    if (this.#markup) dropIcon(this.#markup);
    this.#markup = "";
  }

  /**
   * Listens for what the listeners on its elements need. Elements are told apart only once
   * the svg is live, so listeners make it go live.
   */
  _listenShapes() {
    let types = new Set();
    const visit = (element) => {
      for (const [type, list] of element._listeners ?? []) if (list.length > 0) types.add(type);
      for (const child of element.childNodes) if (child instanceof SvgElement) visit(child);
    };
    for (const child of this.childNodes) if (child instanceof SvgElement) visit(child);
    let extra = 0;
    for (const type of types) {
      const kind = KIND_OF.get(type);
      if (kind === undefined) continue;
      extra = (extra | (1 << bitOf(kind))) >>> 0;
      if (HOVER_TYPES.has(type)) extra |= HOVER_FLAGS;
    }
    if (extra === (this._extra ?? 0)) return;
    this._extra = extra;
    this._relisten();
    if (extra && !this._live) svgChanged(this);
  }

  /** The element numbered `n`, or null. */
  _numbered(n) {
    if (!n) return null;
    const find = (element) => {
      if (element._n === n) return element;
      for (const child of element.childNodes) {
        if (child instanceof SvgElement) {
          const found = find(child);
          if (found) return found;
        }
      }
      return null;
    };
    for (const child of this.childNodes) {
      if (child instanceof SvgElement) {
        const found = find(child);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Sends a pointer record that came to the svg to the element under the pointer, with the
   * over, out, enter and leave events the web sends as the pointer moves between elements.
   */
  _pointer(event) {
    const type = event.type;
    const leaving = type === "pointerout" || type === "pointerleave" || type === "pointercancel";
    const shape = leaving ? null : this._numbered(event._element);
    const old = this._hovered && this._hovered.parentNode && svgOwner(this._hovered) === this ? this._hovered : null;
    let replaced = false;
    if (shape !== old && type !== "pointerenter" && type !== "pointerleave") {
      this._hovered = shape;
      if (old) {
        dispatchEvent(pointerCopy("pointerout", old, event));
        for (let at = old; at instanceof SvgElement && !at.contains(shape); at = at.parentNode) {
          dispatchEvent(pointerCopy("pointerleave", at, event));
        }
        if (type === "pointerout") replaced = true;
      }
      if (shape) {
        dispatchEvent(pointerCopy("pointerover", shape, event));
        if (type === "pointerover") {
          replaced = true;
          this._entering = true;
        } else {
          enterChain(shape, old, event);
        }
      }
    }
    if (replaced) return false;
    if (type === "pointerenter") {
      dispatchEvent(event);
      if (this._entering && this._hovered) enterChain(this._hovered, null, event);
      this._entering = false;
      return event.defaultPrevented;
    }
    if (shape && type !== "pointerleave") event.target = shape;
    dispatchEvent(event);
    return event.defaultPrevented;
  }
}

// Element listeners for these need the svg's moves, enters and leaves to tell hovering apart.
const HOVER_TYPES = new Set(["pointerover", "pointerout", "pointerenter", "pointerleave"]);
const HOVER_FLAGS = (1 << 3) | (1 << 4) | (1 << 5) | (1 << 28) | (1 << 29);

// A pointer event like `base` of type `type` at `target`.
function pointerCopy(type, target, base) {
  const event = new Event(type, target);
  for (const key of Object.keys(base)) {
    if (!(key in event) || key === "clientX" || key === "clientY" || key === "x" || key === "y") event[key] = base[key];
  }
  event.type = type;
  event.target = target;
  event.bubbles = !NO_BUBBLE.has(type);
  event.cancelable = CANCELABLE.has(type);
  return event;
}

// pointerenter at `shape` and its element ancestors not containing `from`, outermost first.
function enterChain(shape, from, base) {
  const chain = [];
  for (let at = shape; at instanceof SvgElement && !(from && at.contains(from)); at = at.parentNode) chain.push(at);
  for (let i = chain.length - 1; i >= 0; i--) dispatchEvent(pointerCopy("pointerenter", chain[i], base));
}

for (const name of ["insertBefore", "appendChild", "append", "removeChild"]) Svg.prototype[name] = svgChildren[name];
Object.defineProperty(Svg.prototype, "textContent", Object.getOwnPropertyDescriptor(svgChildren, "textContent"));

/**
 * An element of tag `tag` in the SVG namespace: an `Svg` root for `svg`, an `SvgElement`
 * inside one for anything else. `document.createElementNS` with the SVG namespace, as it were.
 */
export function createSvgElement(tag) {
  return tag === "svg" ? new Svg() : new SvgElement(tag);
}

/** Draws the `<svg>` roots that changed now, instead of before the host applies the batch. */
export function flushSvg() {
  drawSvgs();
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
    native.mark(this.nodeId, this.#bit(name), cssTextOf(style));
  }

  /** What atoms of `kind` look like: the inline block holding the label. */
  defineAtom(kind, style) {
    native.atomStyle(this.nodeId, this.#kind(kind), cssTextOf(style));
  }

  get document() {
    return this.#document;
  }

  _shallowClone() {
    const copy = new RichInput();
    copy.document = this.#document;
    return copy;
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
    native.richText(this.nodeId, text, packedMarks, packedAtoms);
    const end = byteOf(text, text.length);
    super._changed(text, end, end);
  }

  #packAtom(atom) {
    return this.#kind(atom.kind) + "\0" + String(atom.label ?? "") + "\0" + String(atom.data ?? "") + "\0";
  }

  /** Turns mark `name` on or off over the selection, or for the text typed next. */
  format(name, on = true) {
    native.format(this.nodeId, this.#bit(name), !!on);
  }

  /** Turns mark `name` off where the caret's text has it, on where it does not. */
  toggleMark(name) {
    this.format(name, !this.activeMarks.includes(name));
  }

  /** Replaces the text from `start` to `end` with `atom` (`{ kind, label, data }`). */
  insertAtom(start, end, atom) {
    const text = this.#document.text;
    native.insertAtom(this.nodeId, byteOf(text, start), byteOf(text, end), this.#packAtom(atom));
  }

  // Marks around the range stay, shifted; the replacement takes none. Atoms in the range go,
  // and OBJECT characters in the replacement become U+FFFD, since they would name no atom.
  _replace(start, end, replacement) {
    const { text, marks, atoms } = this.#document;
    replacement = replacement.replaceAll(OBJECT, "\ufffd");
    const delta = replacement.length - (end - start);
    const shift = (index, inside) => (index <= start ? index : index >= end ? index + delta : inside);
    const spans = [];
    for (const span of marks) {
      const from = shift(span.start, start + replacement.length);
      const to = shift(span.end, start);
      if (to > from) spans.push({ start: from, end: to, marks: span.marks });
    }
    let before = 0;
    let inside = 0;
    for (let i = 0; i < end; i++) {
      if (text[i] !== OBJECT) continue;
      if (i < start) before++;
      else inside++;
    }
    const kept = atoms.slice(0, before).concat(atoms.slice(before + inside));
    this.document = { text: text.slice(0, start) + replacement + text.slice(end), marks: spans, atoms: kept };
  }

  _changed(value, anchor, focus, marks, atoms, active) {
    super._changed(value, anchor, focus);
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
    super._selected(start, end);
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
  nodes.delete(node.nodeId);
  node._forget?.();
  for (const child of node.childNodes) {
    child.parentNode = null;
    forget(child);
  }
  node.childNodes = NO_CHILDREN;
}

export function createNode(kind) {
  if (kind === "richinput") return new RichInput();
  if (kind === "svg") return new Svg();
  if (kind === "img") kind = "image";
  if (!(kind in KINDS) || kind === "icon") throw new TypeError("the tree has no node kind '" + kind + "'");
  if (kind === "text") return new Text();
  if (kind === "input") return new Input();
  if (kind === "image") return new Image();
  if (kind === "canvas") return new Canvas();
  return new Node(kind);
}

// `<input>` types that are not a text field.
const BOX_INPUTS = new Set(["checkbox", "radio", "range", "color", "file", "hidden", "submit", "button", "reset", "image"]);
// Tags that take focus without a tabindex, as on the web.
const FOCUSABLE_TAGS = new Set(["button", "select", "summary", "iframe"]);

/**
 * `<input type="checkbox">` and `type="radio"`: a box a click checks, as on the web. It fires
 * `input` and `change` when the click changes it.
 */
export class CheckInput extends Node {
  #checked = false;

  constructor(type = "checkbox") {
    super("box");
    this._tag = "input";
    this.type = type;
    this.value = "on";
    this.defaultChecked = false;
    native.attribute(this.nodeId, "element", "input");
    native.attribute(this.nodeId, "type", type);
    native.attribute(this.nodeId, "role", type === "radio" ? "radio" : "checkbox");
    native.attribute(this.nodeId, "tabIndex", 0);
    this._keep("focus", "blur");
    this._relisten();
  }

  _shallowClone() {
    const copy = new CheckInput(this.type);
    copy.checked = this.#checked;
    return copy;
  }

  get name() {
    return this.getAttribute("name") ?? "";
  }

  get checked() {
    return this.#checked;
  }

  set checked(value) {
    value = !!value;
    if (value === this.#checked) return;
    this.#checked = value;
    native.attribute(this.nodeId, "checked", value);
    if (value && this.type === "radio" && this.name) {
      let top = this;
      while (top.parentNode) top = top.parentNode;
      eachDescendant(top, (node) => {
        if (node !== this && node instanceof CheckInput && node.type === "radio" && node.name === this.name) node.checked = false;
      });
    }
  }

  _activate() {
    if (this.hasAttribute("disabled")) return true;
    if (this.type === "radio" && this.#checked) return true;
    this.checked = this.type === "radio" ? true : !this.#checked;
    const input = new Event("input", this);
    input.bubbles = true;
    dispatchEvent(input);
    const change = new Event("change", this);
    change.bubbles = true;
    dispatchEvent(change);
    return true;
  }
}

function eachDescendant(node, visit) {
  for (const child of node.childNodes) {
    visit(child);
    if (child.childNodes.length) eachDescendant(child, visit);
  }
}

function findById(id) {
  for (const node of nodes.values()) if (node._elementId === id && (node.parentNode || node === rootNode)) return node;
  return null;
}

// What a click on a label, summary or submit button does (see `activate`).
function labelActivate() {
  const id = this.getAttribute("for");
  let control = id ? findById(id) : null;
  if (!control) eachDescendant(this, (node) => {
    if (!control && (node instanceof Input || node instanceof CheckInput)) control = node;
  });
  if (!control) return false;
  if (control instanceof CheckInput) control._activate();
  else control.focus();
  return true;
}

function summaryActivate() {
  const details = this.parentNode;
  if (details?.localName !== "details") return false;
  details.setAttribute("open", details.hasAttribute("open") ? null : "");
  const toggle = new Event("toggle", details);
  dispatchEvent(toggle);
  return true;
}

function buttonActivate() {
  if (this.hasAttribute("disabled")) return true;
  const type = this.getAttribute("type") ?? "submit";
  if (type !== "submit" && type !== "reset") return false;
  let form = this.parentNode;
  while (form && form.localName !== "form") form = form.parentNode;
  if (!form) return false;
  const event = new Event(type, form);
  event.bubbles = true;
  event.cancelable = true;
  event.submitter = this;
  dispatchEvent(event);
  return true;
}

/**
 * The node for HTML element `tag`, as `document.createElement` makes it: `<input>` and
 * `<textarea>` are text fields (an `<input>` whose `type` is not a text field's is a box),
 * `<img>` an image, `<canvas>` a canvas, `<svg>` inline SVG, and every other tag a box the
 * tree knows by its tag, for selectors, its implicit role and the default stylesheet of
 * `@silkui/react`. `localName` and `tagName` give the tag.
 */
// A style element in the document applies its text as a stylesheet, after the compiled
// imports and before adopted sheets, in tree order. Changes apply together at the next microtask.

function stylesChanged() {
  if (stylesPending) return;
  stylesPending = true;
  queueMicrotask(applyStyleElements);
}

function applyStyleElements() {
  stylesPending = false;
  const live = [];
  for (const element of styleElements) {
    if (!nodes.has(element.nodeId)) styleElements.delete(element);
    else if (inDocument(element)) live.push(element);
  }
  live.sort(treeOrder);
  let changed = live.length !== appliedStyles.length;
  for (let i = 0; i < live.length; i++) {
    if (live[i]._compile()) changed = true;
    if (live[i] !== appliedStyles[i]) changed = true;
  }
  appliedStyles = live;
  if (changed) syncAdoptedSheets();
}

/** `<style>`: its text is a stylesheet while it is in the document. */
export class StyleElement extends Node {
  _styleSheet = null;
  #compiled = null;

  constructor() {
    super("box");
    styleElements.add(this);
  }

  /** The element's stylesheet while it is in the document, else null. */
  get sheet() {
    return inDocument(this) ? this._styleSheet : null;
  }

  // Compiles changed text. True when the element gained its first sheet.
  _compile() {
    let text = "";
    for (const child of this.childNodes) if (child.nodeType === 3) text += child.data;
    if (text === this.#compiled) return false;
    this.#compiled = text;
    if (!native.compileStyleSheet) {
      warnOnce("@silkui/core: a style element's CSS needs the host's CSS text compiler (App.runtimeStylesheets() in a release build)");
      return false;
    }
    let bytes;
    try {
      bytes = native.compileStyleSheet(text);
    } catch (error) {
      console.warn("@silkui/core: a style element's CSS did not compile: " + (error?.message ?? error));
      return false;
    }
    const first = this._styleSheet === null;
    this._styleSheet ??= new CSSStyleSheet();
    replaceSheet(this._styleSheet, bytes);
    return first;
  }
}

export function createElement(tag, options) {
  tag = String(tag).toLowerCase();
  const type = String(options?.type ?? "text").toLowerCase();
  let node;
  if (tag === "svg") return new Svg();
  if (tag === "input" && (type === "checkbox" || type === "radio")) return new CheckInput(type);
  if (tag === "input" && !BOX_INPUTS.has(type)) node = new Input();
  else if (tag === "textarea") node = new Input();
  else if (tag === "img") node = new Image();
  else if (tag === "canvas") node = new Canvas();
  else if (tag === "br") return new LineBreak();
  else if (tag === "style") node = new StyleElement();
  else node = new Node("box");
  node._tag = tag;
  native.attribute(node.nodeId, "element", tag);
  if (tag === "textarea") native.attribute(node.nodeId, "multiline", true);
  if (tag === "input" && type !== "text") native.attribute(node.nodeId, "type", type);
  if (node instanceof Input || FOCUSABLE_TAGS.has(tag)) {
    if (!(node instanceof Input)) native.attribute(node.nodeId, "tabIndex", 0);
    node._keep("focus", "blur");
  }
  if (tag === "label") node._activate = labelActivate;
  else if (tag === "summary") node._activate = summaryActivate;
  else if (tag === "button") node._activate = buttonActivate;
  if (node._activate) node._relisten();
  return node;
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
// Elements whose content is not markup. Scripts and styles in parsed HTML are left out.
const RAW_TAGS = new Set(["script", "style", "textarea", "title"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", times: "×", middot: "·", bull: "•" };
const ATTRIBUTE = /\s*([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;

function decodeEntities(text) {
  if (!text.includes("&")) return text;
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name] ?? whole;
  });
}

const escapeText = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
const escapeAttribute = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function markupOf(node) {
  if (node.nodeType === 3) return escapeText(node.data);
  if (node instanceof Svg || node instanceof SvgElement) return node.outerHTML ?? node._markup();
  if (node.nodeType === 11) return node.innerHTML;
  const tag = node.localName;
  let html = "<" + tag;
  for (const name of node.getAttributeNames()) if (name !== "style") html += " " + name + '="' + escapeAttribute(node.getAttribute(name)) + '"';
  const css = node.look("base").cssText;
  if (css) html += ' style="' + escapeAttribute(css) + '"';
  html += ">";
  if (VOID_TAGS.has(tag)) return html;
  if (node instanceof Input) html += escapeText(node.value);
  else html += node.innerHTML;
  return html + "</" + tag + ">";
}

/**
 * Parses `html` and appends its nodes to `parent`, as `innerHTML` does: elements, text with
 * character references, and `<svg>` markup. Comments, scripts and styles are left out.
 */
export function parseHTML(html, parent) {
  const stack = [parent];
  const top = () => stack[stack.length - 1];
  const inSvg = () => top() instanceof Svg || top() instanceof SvgElement;
  let i = 0;
  const text = (data) => {
    if (!data) return;
    const value = decodeEntities(data);
    top().appendChild(inSvg() ? new SvgText(value) : createText(value));
  };
  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open < 0) {
      text(html.slice(i));
      break;
    }
    text(html.slice(i, open));
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[open + 1] === "!" || html[open + 1] === "?") {
      const end = html.indexOf(">", open);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    if (html[open + 1] === "/") {
      const end = html.indexOf(">", open);
      const name = html.slice(open + 2, end < 0 ? html.length : end).trim().toLowerCase();
      i = end < 0 ? html.length : end + 1;
      for (let at = stack.length - 1; at > 0; at--) {
        if (stack[at].localName.toLowerCase() === name) {
          stack.length = at;
          break;
        }
      }
      continue;
    }
    const nameMatch = /^[a-zA-Z][^\s\/>]*/.exec(html.slice(open + 1, open + 64));
    if (!nameMatch) {
      text("<");
      i = open + 1;
      continue;
    }
    const written = nameMatch[0];
    const tag = inSvg() ? written : written.toLowerCase();
    let at = open + 1 + written.length;
    const attributes = [];
    ATTRIBUTE.lastIndex = at;
    for (let match; (match = ATTRIBUTE.exec(html)); ATTRIBUTE.lastIndex = at) {
      at = ATTRIBUTE.lastIndex;
      attributes.push([match[1], decodeEntities(match[2] ?? match[3] ?? match[4] ?? "")]);
    }
    while (at < html.length && html[at] !== ">") at++;
    const selfClosing = html[at - 1] === "/";
    i = at + 1;
    if (RAW_TAGS.has(tag)) {
      const close = html.toLowerCase().indexOf("</" + tag, i);
      const content = html.slice(i, close < 0 ? html.length : close);
      const end = close < 0 ? html.length : html.indexOf(">", close);
      i = end < 0 ? html.length : end + 1;
      if (tag === "script" || tag === "style") continue;
      const node = createElement(tag);
      for (const [name, value] of attributes) node.setAttribute(name, value);
      if (tag === "textarea") node.value = decodeEntities(content);
      else node.appendChild(createText(decodeEntities(content)));
      top().appendChild(node);
      continue;
    }
    const svg = inSvg() || tag === "svg";
    const type = attributes.find(([name]) => name.toLowerCase() === "type")?.[1];
    const node = svg ? createSvgElement(tag) : createElement(tag, { type });
    for (const [name, value] of attributes) {
      if (!svg && name.toLowerCase() === "value" && node instanceof Input) node.value = value;
      else node.setAttribute(svg ? name : name.toLowerCase(), value);
    }
    top().appendChild(node);
    if (!selfClosing && !(VOID_TAGS.has(tag) && !svg)) stack.push(node);
  }
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

/** An image showing `src` (see `Image`), with `style` as its base look. */
export function createImage(src, style) {
  const image = new Image(src);
  if (style) image.style.set(style);
  return image;
}

export function createInput(style) {
  const input = new Input();
  if (style) input.style.set(style);
  return input;
}

/**
 * Nodes held together outside the tree, as the DOM's `DocumentFragment`. Inserting it
 * inserts its children, in order, and leaves it empty.
 */
export class DocumentFragment extends Node {
  constructor() {
    super("box");
  }

  get nodeType() {
    return 11;
  }

  _shallowClone() {
    return new DocumentFragment();
  }
}

export function createDocumentFragment() {
  return new DocumentFragment();
}

// Ranges, as the DOM Standard defines them, over the nodes of this module. Every change to
// the tree passes through these nodes, so live ranges follow it here, with no native calls.

function nodeLength(node) {
  return node.nodeType === 3 ? node.length : node.childNodes.length;
}

function indexIn(node) {
  return node.parentNode ? node.parentNode.childNodes.indexOf(node) : 0;
}

function rootOf(node) {
  while (node.parentNode) node = node.parentNode;
  return node;
}

function isInclusiveAncestor(ancestor, node) {
  for (; node; node = node.parentNode) if (node === ancestor) return true;
  return false;
}

// -1 when `a` comes before `b` in tree order, 1 after, 0 the same node. One root.
function treeOrder(a, b) {
  if (a === b) return 0;
  const up = [];
  for (let node = a; node; node = node.parentNode) up.push(node);
  const other = [];
  for (let node = b; node; node = node.parentNode) other.push(node);
  let i = up.length - 1;
  let j = other.length - 1;
  while (i >= 0 && j >= 0 && up[i] === other[j]) {
    i--;
    j--;
  }
  if (i < 0) return -1;
  if (j < 0) return 1;
  const siblings = up[i + 1].childNodes;
  return siblings.indexOf(up[i]) < siblings.indexOf(other[j]) ? -1 : 1;
}

// The position of boundary point (a, aOffset) relative to (b, bOffset): -1 before, 0 equal,
// 1 after. Both are in one tree.
function comparePoints(a, aOffset, b, bOffset) {
  if (a === b) return aOffset === bOffset ? 0 : aOffset < bOffset ? -1 : 1;
  if (treeOrder(a, b) > 0) return -comparePoints(b, bOffset, a, aOffset);
  if (isInclusiveAncestor(a, b)) {
    let child = b;
    while (child.parentNode !== a) child = child.parentNode;
    if (indexIn(child) < aOffset) return 1;
  }
  return -1;
}

// The next node in tree order inside `within`, or null.
function following(node, within, skipChildren = false) {
  if (!skipChildren && node.childNodes.length) return node.childNodes[0];
  for (; node && node !== within; node = node.parentNode) {
    const next = node.nextSibling;
    if (next) return next;
  }
  return null;
}

function checkNode(node, what) {
  if (!(node instanceof Node)) throw new TypeError(what + " is not a node");
  return node;
}

/** The fields every range has: two boundary points. */
export class AbstractRange {
  constructor() {
    if (new.target === AbstractRange) throw new TypeError("Illegal constructor");
  }

  get startContainer() {
    return this._startNode;
  }

  get startOffset() {
    return this._startOffset;
  }

  get endContainer() {
    return this._endNode;
  }

  get endOffset() {
    return this._endOffset;
  }

  get collapsed() {
    return this._startNode === this._endNode && this._startOffset === this._endOffset;
  }
}

/** A range that does not follow changes to the tree, and is not checked when made. */
export class StaticRange extends AbstractRange {
  constructor(init) {
    super();
    if (init == null || typeof init !== "object") throw new TypeError("StaticRange needs its four members");
    for (const key of ["startContainer", "startOffset", "endContainer", "endOffset"]) {
      if (init[key] === undefined) throw new TypeError("StaticRange needs " + key);
    }
    this._startNode = checkNode(init.startContainer, "startContainer");
    this._startOffset = init.startOffset >>> 0;
    this._endNode = checkNode(init.endContainer, "endContainer");
    this._endOffset = init.endOffset >>> 0;
  }
}

// The node a new range starts in: the mounted root, else a detached one of its own.
let rangeHome = null;

/** A live range: it follows insertions, removals and text changes, as on the web. */
export class Range extends AbstractRange {
  static START_TO_START = 0;
  static START_TO_END = 1;
  static END_TO_END = 2;
  static END_TO_START = 3;

  constructor() {
    super();
    const home = rootNode ?? (rangeHome ??= new Node("box"));
    this._startNode = this._endNode = home;
    this._startOffset = this._endOffset = 0;
    liveRanges.add(new WeakRef(this));
  }

  get commonAncestorContainer() {
    let container = this._startNode;
    while (!isInclusiveAncestor(container, this._endNode)) container = container.parentNode;
    return container;
  }

  // Called after the boundary points change; a selection's range tells the tree.
  _changed() {}

  #set(node, offset, start) {
    checkNode(node, "the container");
    offset = offset >>> 0;
    if (offset > nodeLength(node)) throw domError("IndexSizeError", "the offset is past the end of the node");
    if (start) {
      if (rootOf(node) !== rootOf(this._startNode) || comparePoints(node, offset, this._endNode, this._endOffset) > 0) {
        this._endNode = node;
        this._endOffset = offset;
      }
      this._startNode = node;
      this._startOffset = offset;
    } else {
      if (rootOf(node) !== rootOf(this._startNode) || comparePoints(node, offset, this._startNode, this._startOffset) < 0) {
        this._startNode = node;
        this._startOffset = offset;
      }
      this._endNode = node;
      this._endOffset = offset;
    }
    this._changed();
  }

  setStart(node, offset) {
    this.#set(node, offset, true);
  }

  setEnd(node, offset) {
    this.#set(node, offset, false);
  }

  /** One rectangle per line piece of the range, from the tree's last layout (laid out first if something changed). */
  getClientRects() {
    return rangeClientRects(this._startNode, this._startOffset, this._endNode, this._endOffset);
  }

  getBoundingClientRect() {
    return rangeBoundingClientRect(this._startNode, this._startOffset, this._endNode, this._endOffset);
  }

  setStartBefore(node) {
    this.#set(parentOf(node), indexIn(node), true);
  }

  setStartAfter(node) {
    this.#set(parentOf(node), indexIn(node) + 1, true);
  }

  setEndBefore(node) {
    this.#set(parentOf(node), indexIn(node), false);
  }

  setEndAfter(node) {
    this.#set(parentOf(node), indexIn(node) + 1, false);
  }

  collapse(toStart = false) {
    if (toStart) {
      this._endNode = this._startNode;
      this._endOffset = this._startOffset;
    } else {
      this._startNode = this._endNode;
      this._startOffset = this._endOffset;
    }
    this._changed();
  }

  selectNode(node) {
    const parent = parentOf(node);
    const index = indexIn(node);
    this.#select(parent, index, parent, index + 1);
  }

  selectNodeContents(node) {
    checkNode(node, "the node");
    this.#select(node, 0, node, nodeLength(node));
  }

  #select(startNode, startOffset, endNode, endOffset) {
    this._startNode = startNode;
    this._startOffset = startOffset;
    this._endNode = endNode;
    this._endOffset = endOffset;
    this._changed();
  }

  compareBoundaryPoints(how, sourceRange) {
    how = Number(how) & 0xffff;
    if (how > 3) throw domError("NotSupportedError", "compareBoundaryPoints takes 0 to 3");
    if (!(sourceRange instanceof Range)) throw new TypeError("compareBoundaryPoints takes a Range");
    if (rootOf(this._startNode) !== rootOf(sourceRange._startNode)) throw domError("WrongDocumentError", "the ranges are in different trees");
    const thisStart = how === 0 || how === 3;
    const otherStart = how === 0 || how === 1;
    return comparePoints(
      thisStart ? this._startNode : this._endNode,
      thisStart ? this._startOffset : this._endOffset,
      otherStart ? sourceRange._startNode : sourceRange._endNode,
      otherStart ? sourceRange._startOffset : sourceRange._endOffset,
    );
  }

  #checkPoint(node, offset) {
    if (offset > nodeLength(node)) throw domError("IndexSizeError", "the offset is past the end of the node");
  }

  comparePoint(node, offset) {
    checkNode(node, "the node");
    offset = offset >>> 0;
    if (rootOf(node) !== rootOf(this._startNode)) throw domError("WrongDocumentError", "the node is in a different tree");
    this.#checkPoint(node, offset);
    if (comparePoints(node, offset, this._startNode, this._startOffset) < 0) return -1;
    if (comparePoints(node, offset, this._endNode, this._endOffset) > 0) return 1;
    return 0;
  }

  isPointInRange(node, offset) {
    checkNode(node, "the node");
    offset = offset >>> 0;
    if (rootOf(node) !== rootOf(this._startNode)) return false;
    this.#checkPoint(node, offset);
    return comparePoints(node, offset, this._startNode, this._startOffset) >= 0
      && comparePoints(node, offset, this._endNode, this._endOffset) <= 0;
  }

  intersectsNode(node) {
    checkNode(node, "the node");
    if (rootOf(node) !== rootOf(this._startNode)) return false;
    const parent = node.parentNode;
    if (!parent) return true;
    const offset = indexIn(node);
    return comparePoints(parent, offset, this._endNode, this._endOffset) < 0
      && comparePoints(parent, offset + 1, this._startNode, this._startOffset) > 0;
  }

  cloneRange() {
    const copy = new Range();
    copy.#select(this._startNode, this._startOffset, this._endNode, this._endOffset);
    return copy;
  }

  detach() {}

  #contains(node) {
    return rootOf(node) === rootOf(this._startNode)
      && comparePoints(node, 0, this._startNode, this._startOffset) > 0
      && comparePoints(node, nodeLength(node), this._endNode, this._endOffset) < 0;
  }

  #partlyContains(node) {
    return isInclusiveAncestor(node, this._startNode) !== isInclusiveAncestor(node, this._endNode);
  }

  toString() {
    const start = this._startNode;
    const end = this._endNode;
    if (start === end && start.nodeType === 3) return start.data.slice(this._startOffset, this._endOffset);
    let text = start.nodeType === 3 ? start.data.slice(this._startOffset) : "";
    const within = this.commonAncestorContainer;
    for (let node = following(within, within); node; node = following(node, within)) {
      if (node.nodeType === 3 && this.#contains(node)) text += node.data;
    }
    if (end.nodeType === 3) text += end.data.slice(0, this._endOffset);
    return text;
  }

  // The parts of the contents algorithms the three of them share.
  #split() {
    const startNode = this._startNode;
    const endNode = this._endNode;
    const common = this.commonAncestorContainer;
    const children = common.childNodes;
    const first = isInclusiveAncestor(startNode, endNode) ? null : children.find((child) => this.#partlyContains(child)) ?? null;
    let last = null;
    if (!isInclusiveAncestor(endNode, startNode)) {
      for (let i = children.length - 1; i >= 0; i--) {
        if (this.#partlyContains(children[i])) {
          last = children[i];
          break;
        }
      }
    }
    return { common, first, last, contained: children.filter((child) => this.#contains(child)) };
  }

  // Where the range collapses after its contents leave.
  #after() {
    if (isInclusiveAncestor(this._startNode, this._endNode)) return [this._startNode, this._startOffset];
    let reference = this._startNode;
    while (reference.parentNode && !isInclusiveAncestor(reference.parentNode, this._endNode)) reference = reference.parentNode;
    return [reference.parentNode, indexIn(reference) + 1];
  }

  deleteContents() {
    if (this.collapsed) return;
    const startNode = this._startNode;
    const startOffset = this._startOffset;
    const endNode = this._endNode;
    const endOffset = this._endOffset;
    if (startNode === endNode && startNode.nodeType === 3) {
      startNode.replaceData(startOffset, endOffset - startOffset, "");
      return;
    }
    const remove = [];
    const within = this.commonAncestorContainer;
    for (let node = following(within, within); node; ) {
      if (this.#contains(node)) {
        remove.push(node);
        node = following(node, within, true);
      } else {
        node = following(node, within);
      }
    }
    const [node, offset] = this.#after();
    if (startNode.nodeType === 3) startNode.replaceData(startOffset, startNode.length - startOffset, "");
    for (const child of remove) child.remove();
    if (endNode.nodeType === 3) endNode.replaceData(0, endOffset, "");
    this.#select(node, offset, node, offset);
  }

  #contents(extract) {
    const fragment = new DocumentFragment();
    if (this.collapsed) return fragment;
    const startNode = this._startNode;
    const startOffset = this._startOffset;
    const endNode = this._endNode;
    const endOffset = this._endOffset;
    if (startNode === endNode && startNode.nodeType === 3) {
      const clone = startNode.cloneNode();
      clone.data = startNode.substringData(startOffset, endOffset - startOffset);
      fragment.appendChild(clone);
      if (extract) startNode.replaceData(startOffset, endOffset - startOffset, "");
      return fragment;
    }
    const { first, last, contained } = this.#split();
    const after = extract ? this.#after() : null;
    if (first?.nodeType === 3) {
      const clone = startNode.cloneNode();
      clone.data = startNode.substringData(startOffset, startNode.length - startOffset);
      fragment.appendChild(clone);
      if (extract) startNode.replaceData(startOffset, startNode.length - startOffset, "");
    } else if (first) {
      const clone = first.cloneNode();
      fragment.appendChild(clone);
      const inner = new Range();
      inner.#select(startNode, startOffset, first, nodeLength(first));
      clone.appendChild(inner.#contents(extract));
    }
    for (const child of contained) fragment.appendChild(extract ? child : child.cloneNode(true));
    if (last?.nodeType === 3) {
      const clone = endNode.cloneNode();
      clone.data = endNode.substringData(0, endOffset);
      fragment.appendChild(clone);
      if (extract) endNode.replaceData(0, endOffset, "");
    } else if (last) {
      const clone = last.cloneNode();
      fragment.appendChild(clone);
      const inner = new Range();
      inner.#select(last, 0, endNode, endOffset);
      clone.appendChild(inner.#contents(extract));
    }
    if (extract) this.#select(after[0], after[1], after[0], after[1]);
    return fragment;
  }

  /** Moves the contents into a new fragment and collapses the range where they were. */
  extractContents() {
    return this.#contents(true);
  }

  /** Copies the contents into a new fragment. */
  cloneContents() {
    return this.#contents(false);
  }

  /** Inserts `node` at the start of the range. */
  insertNode(node) {
    checkNode(node, "the node");
    const start = this._startNode;
    if ((start.nodeType === 3 && !start.parentNode) || start === node) {
      throw domError("HierarchyRequestError", "cannot insert the node there");
    }
    let reference = start.nodeType === 3 ? start : start.childNodes[this._startOffset] ?? null;
    const parent = reference ? reference.parentNode : start;
    if (isInclusiveAncestor(node, parent)) throw domError("HierarchyRequestError", "a node cannot be inserted into itself");
    if (parent.nodeType === 3) throw domError("HierarchyRequestError", "text has no children");
    if (start.nodeType === 3) reference = start.splitText(this._startOffset);
    if (node === reference) reference = node.nextSibling;
    if (node.parentNode) node.remove();
    let offset = reference ? indexIn(reference) : nodeLength(parent);
    offset += node.nodeType === 11 ? node.childNodes.length : 1;
    parent.insertBefore(node, reference);
    if (this.collapsed) this.#set(parent, offset, false);
  }

  /** Wraps the contents in `newParent`. */
  surroundContents(newParent) {
    checkNode(newParent, "the new parent");
    const within = this.commonAncestorContainer;
    for (let node = within; node; node = following(node, within)) {
      if (node.nodeType !== 3 && this.#partlyContains(node)) {
        throw domError("InvalidStateError", "the range splits an element");
      }
    }
    if (newParent.nodeType === 11) throw domError("InvalidNodeTypeError", "a fragment cannot surround the range");
    const fragment = this.extractContents();
    while (newParent.firstChild) newParent.removeChild(newParent.firstChild);
    this.insertNode(newParent);
    newParent.appendChild(fragment);
    this.selectNode(newParent);
  }

  // The DOM Standard's live range steps, run by the nodes as they change.

  _inserted(parent, index) {
    const a = this._startNode, b = this._startOffset, c = this._endNode, d = this._endOffset;
    if (this._startNode === parent && this._startOffset > index) this._startOffset++;
    if (this._endNode === parent && this._endOffset > index) this._endOffset++;
    if (a !== this._startNode || b !== this._startOffset || c !== this._endNode || d !== this._endOffset) this._changed();
  }

  _removing(child, parent, index) {
    const a = this._startNode, b = this._startOffset, c = this._endNode, d = this._endOffset;
    if (isInclusiveAncestor(child, this._startNode)) {
      this._startNode = parent;
      this._startOffset = index;
    }
    if (isInclusiveAncestor(child, this._endNode)) {
      this._endNode = parent;
      this._endOffset = index;
    }
    if (this._startNode === parent && this._startOffset > index) this._startOffset--;
    if (this._endNode === parent && this._endOffset > index) this._endOffset--;
    if (a !== this._startNode || b !== this._startOffset || c !== this._endNode || d !== this._endOffset) this._changed();
  }

  _replaced(node, offset, count, added) {
    const a = this._startNode, b = this._startOffset, c = this._endNode, d = this._endOffset;
    if (this._startNode === node) {
      if (this._startOffset > offset + count) this._startOffset += added - count;
      else if (this._startOffset > offset) this._startOffset = offset;
    }
    if (this._endNode === node) {
      if (this._endOffset > offset + count) this._endOffset += added - count;
      else if (this._endOffset > offset) this._endOffset = offset;
    }
    if (a !== this._startNode || b !== this._startOffset || c !== this._endNode || d !== this._endOffset) this._changed();
  }

  _split(node, rest, offset, parent, index) {
    const a = this._startNode, b = this._startOffset, c = this._endNode, d = this._endOffset;
    if (this._startNode === node && this._startOffset > offset) {
      this._startNode = rest;
      this._startOffset -= offset;
    }
    if (this._endNode === node && this._endOffset > offset) {
      this._endNode = rest;
      this._endOffset -= offset;
    }
    if (this._startNode === parent && this._startOffset === index + 1) this._startOffset++;
    if (this._endNode === parent && this._endOffset === index + 1) this._endOffset++;
    if (a !== this._startNode || b !== this._startOffset || c !== this._endNode || d !== this._endOffset) this._changed();
  }

  _joined(current, node, length, index) {
    const a = this._startNode, b = this._startOffset, c = this._endNode, d = this._endOffset;
    if (this._startNode === current) {
      this._startNode = node;
      this._startOffset += length;
    }
    if (this._endNode === current) {
      this._endNode = node;
      this._endOffset += length;
    }
    if (this._startNode === current.parentNode && this._startOffset === index) {
      this._startNode = node;
      this._startOffset = length;
    }
    if (this._endNode === current.parentNode && this._endOffset === index) {
      this._endNode = node;
      this._endOffset = length;
    }
    if (a !== this._startNode || b !== this._startOffset || c !== this._endNode || d !== this._endOffset) this._changed();
  }
}

for (const [name, value] of [["START_TO_START", 0], ["START_TO_END", 1], ["END_TO_END", 2], ["END_TO_START", 3]]) {
  Object.defineProperty(Range.prototype, name, { value, enumerable: true });
}

function parentOf(node) {
  checkNode(node, "the node");
  if (!node.parentNode) throw domError("InvalidNodeTypeError", "the node has no parent");
  return node.parentNode;
}

/** A new live range, collapsed at the start of the root. */
export function createRange() {
  return new Range();
}

// The document's selection. The tree keeps it (presses, drags, keys, select all) and paints
// it; the one `Selection` reads it from there and tells the tree what scripts change. Its
// ranges are live Ranges in tree order, one per stretch: a selection across children that
// layout reorders (flex order, placed grid cells, positioned boxes) has one per piece seen.
const SELECTION = Symbol("selection");
let theSelection = null;

function checkOffset(node, offset) {
  offset = offset >>> 0;
  if (offset > nodeLength(node)) throw domError("IndexSizeError", "the offset is past the end of the node");
  return offset;
}

function inDocument(node) {
  return rootNode !== null && rootOf(node) === rootNode;
}

/** The document's selection, as `getSelection()` answers it. */
export class Selection {
  #anchor = null;
  #anchorOffset = 0;
  #focus = null;
  #focusOffset = 0;
  #ranges = [];
  #backward = false;
  // Changed by a script and not yet told to the tree.
  #pending = false;

  constructor(token) {
    if (token !== SELECTION) throw new TypeError("Illegal constructor");
  }

  // Reads what the tree has, after telling it what a script changed.
  #sync() {
    if (this.#pending) this.#flush();
    const count = native.selection?.() ?? 0;
    const rawAnchor = count ? nodes.get(geometry(0)) : null;
    const rawFocus = count ? nodes.get(geometry(2)) : null;
    if (!rawAnchor || !rawFocus) {
      if (this.#anchor) this.#forget();
      return;
    }
    const [anchor, anchorOffset] = fromTreePoint(rawAnchor, geometry(1));
    const [focus, focusOffset] = fromTreePoint(rawFocus, geometry(3));
    const stretches = [];
    for (let i = 0; i < count; i++) {
      const at = 4 + 4 * i;
      const start = nodes.get(geometry(at));
      const end = nodes.get(geometry(at + 2));
      if (start && end) stretches.push([...fromTreePoint(start, geometry(at + 1)), ...fromTreePoint(end, geometry(at + 3))]);
    }
    const same = anchor === this.#anchor && anchorOffset === this.#anchorOffset && focus === this.#focus
      && focusOffset === this.#focusOffset && stretches.length === this.#ranges.length
      && stretches.every(([a, b, c, d], i) => {
        const range = this.#ranges[i];
        return range._startNode === a && range._startOffset === b && range._endNode === c && range._endOffset === d;
      });
    if (same) return;
    this.#unhook();
    this.#anchor = anchor;
    this.#anchorOffset = anchorOffset;
    this.#focus = focus;
    this.#focusOffset = focusOffset;
    this.#backward = comparePoints(anchor, this.#anchorOffset, focus, this.#focusOffset) > 0;
    this.#ranges = stretches.map(([a, b, c, d]) => {
      const range = new Range();
      range._startNode = a;
      range._startOffset = b;
      range._endNode = c;
      range._endOffset = d;
      return this.#hook(range);
    });
  }

  #flush() {
    this.#pending = false;
    if (!this.#anchor) native.setSelection?.(0, 0, 0, 0);
    else native.setSelection?.(this.#anchor.nodeId, this.#anchorOffset, this.#focus.nodeId, this.#focusOffset);
  }

  #schedule() {
    if (this.#pending) return;
    this.#pending = true;
    queueMicrotask(() => {
      if (this.#pending) this.#flush();
    });
  }

  #hook(range) {
    range._changed = () => this.#moved(range);
    return range;
  }

  #unhook() {
    for (const range of this.#ranges) delete range._changed;
  }

  #forget() {
    this.#unhook();
    this.#anchor = this.#focus = null;
    this.#anchorOffset = this.#focusOffset = 0;
    this.#ranges = [];
    this.#backward = false;
  }

  // A script or a mutation moved one of the ranges: the selection becomes that range.
  #moved(range) {
    const backward = this.#backward;
    this.#unhook();
    this.#ranges = [this.#hook(range)];
    this.#anchor = backward ? range._endNode : range._startNode;
    this.#anchorOffset = backward ? range._endOffset : range._startOffset;
    this.#focus = backward ? range._startNode : range._endNode;
    this.#focusOffset = backward ? range._startOffset : range._endOffset;
    this.#schedule();
  }

  #set(anchor, anchorOffset, focus, focusOffset) {
    const range = new Range();
    const forward = comparePoints(anchor, anchorOffset, focus, focusOffset) <= 0;
    range._startNode = forward ? anchor : focus;
    range._startOffset = forward ? anchorOffset : focusOffset;
    range._endNode = forward ? focus : anchor;
    range._endOffset = forward ? focusOffset : anchorOffset;
    this.#unhook();
    this.#ranges = [this.#hook(range)];
    this.#anchor = anchor;
    this.#anchorOffset = anchorOffset;
    this.#focus = focus;
    this.#focusOffset = focusOffset;
    this.#backward = !forward;
    this.#schedule();
  }

  get anchorNode() { this.#sync(); return this.#anchor; }
  get anchorOffset() { this.#sync(); return this.#anchorOffset; }
  get focusNode() { this.#sync(); return this.#focus; }
  get focusOffset() { this.#sync(); return this.#focusOffset; }

  get isCollapsed() {
    this.#sync();
    return this.#anchor === this.#focus && this.#anchorOffset === this.#focusOffset;
  }

  get rangeCount() { this.#sync(); return this.#ranges.length; }

  /** "None", "Caret" (collapsed) or "Range". */
  get type() {
    this.#sync();
    return !this.#anchor ? "None" : this.isCollapsed ? "Caret" : "Range";
  }

  /** "forward" when the focus comes after the anchor, "backward" before it, "none" when collapsed. */
  get direction() {
    this.#sync();
    if (!this.#anchor || this.isCollapsed) return "none";
    return this.#backward ? "backward" : "forward";
  }

  getRangeAt(index) {
    this.#sync();
    index = index >>> 0;
    if (index >= this.#ranges.length) throw domError("IndexSizeError", "the selection has no range " + index);
    return this.#ranges[index];
  }

  /** Selects `range`, which then is the selection's own: changing it changes the selection. Does nothing while something is selected. */
  addRange(range) {
    if (!(range instanceof Range)) throw new TypeError("addRange takes a Range");
    this.#sync();
    if (this.#ranges.length || !inDocument(range._startNode)) return;
    this.#unhook();
    this.#ranges = [this.#hook(range)];
    this.#anchor = range._startNode;
    this.#anchorOffset = range._startOffset;
    this.#focus = range._endNode;
    this.#focusOffset = range._endOffset;
    this.#backward = false;
    this.#schedule();
  }

  removeRange(range) {
    this.#sync();
    if (!this.#ranges.includes(range)) throw domError("NotFoundError", "the range is not in the selection");
    this.removeAllRanges();
  }

  removeAllRanges() {
    if (!this.#anchor && !this.#pending && !this.#ranges.length) {
      this.#sync();
      if (!this.#anchor) return;
    }
    this.#forget();
    this.#schedule();
  }

  empty() { this.removeAllRanges(); }

  /** Puts a caret at (`node`, `offset`); `null` removes the selection. */
  collapse(node, offset = 0) {
    if (node === null) return this.removeAllRanges();
    checkNode(node, "the node");
    offset = checkOffset(node, offset);
    if (inDocument(node)) this.#set(node, offset, node, offset);
  }

  setPosition(node, offset = 0) { return this.collapse(node, offset); }

  collapseToStart() {
    this.#sync();
    if (!this.#ranges.length) throw domError("InvalidStateError", "nothing is selected");
    const first = this.#ranges[0];
    this.#set(first._startNode, first._startOffset, first._startNode, first._startOffset);
  }

  collapseToEnd() {
    this.#sync();
    if (!this.#ranges.length) throw domError("InvalidStateError", "nothing is selected");
    const last = this.#ranges[this.#ranges.length - 1];
    this.#set(last._endNode, last._endOffset, last._endNode, last._endOffset);
  }

  /** Moves the focus to (`node`, `offset`); the anchor stays. */
  extend(node, offset = 0) {
    checkNode(node, "the node");
    this.#sync();
    if (!this.#anchor) throw domError("InvalidStateError", "nothing is selected");
    offset = checkOffset(node, offset);
    if (inDocument(node)) this.#set(this.#anchor, this.#anchorOffset, node, offset);
  }

  setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
    checkNode(anchorNode, "the anchor node");
    checkNode(focusNode, "the focus node");
    anchorOffset = checkOffset(anchorNode, anchorOffset);
    focusOffset = checkOffset(focusNode, focusOffset);
    if (inDocument(anchorNode) && inDocument(focusNode)) this.#set(anchorNode, anchorOffset, focusNode, focusOffset);
  }

  selectAllChildren(node) {
    checkNode(node, "the node");
    if (inDocument(node)) this.#set(node, 0, node, node.childNodes.length);
  }

  deleteFromDocument() {
    this.#sync();
    for (const range of [...this.#ranges]) range.deleteContents();
  }

  /** Whether the selection holds all of `node`, or any of it with `allowPartialContainment`. */
  containsNode(node, allowPartialContainment = false) {
    checkNode(node, "the node");
    this.#sync();
    if (!this.#ranges.length || !inDocument(node)) return false;
    const parent = node.parentNode;
    const startNode = parent ?? node;
    const start = parent ? indexIn(node) : 0;
    const endNode = parent ?? node;
    const end = parent ? start + 1 : nodeLength(node);
    return this.#ranges.some((range) => allowPartialContainment
      ? comparePoints(startNode, start, range._endNode, range._endOffset) < 0 && comparePoints(endNode, end, range._startNode, range._startOffset) > 0
      : comparePoints(range._startNode, range._startOffset, startNode, start) <= 0 && comparePoints(endNode, end, range._endNode, range._endOffset) <= 0);
  }

  getComposedRanges() {
    this.#sync();
    return this.#ranges.map((range) => new StaticRange({
      startContainer: range._startNode, startOffset: range._startOffset, endContainer: range._endNode, endOffset: range._endOffset,
    }));
  }

  /** The selected text as copying gives it: rendered white space, line breaks between blocks. */
  toString() {
    this.#sync();
    if (!this.#ranges.length) return "";
    return native.selectionText?.() ?? this.#ranges.map((range) => range.toString()).join("");
  }
}

/** The document's selection: what the user selected, which scripts can read and change. */
export function getSelection() {
  return (theSelection ??= new Selection(SELECTION));
}

globalThis.Selection ??= Selection;
globalThis.getSelection ??= getSelection;

// A `SelectionChange` record at a node that is not an input: `selectstart` where a press
// started a selection (its `selectionStart` is 1), else the document's `selectionchange` at
// the root.
function selectionRecord(target, start) {
  const event = new Event(start === 1 ? "selectstart" : "selectionchange", target);
  if (start !== 1) event.bubbles = false;
  dispatchEvent(event);
  // As on the web, `selectionchange` is the document's event too.
  if (start !== 1 && outerTargets.length) outerTargets[0].dispatchEvent?.(new Event("selectionchange", null));
  if (event.defaultPrevented) {
    const selection = getSelection();
    selection.removeAllRanges();
    // Read back at once, so the tree stops the press before the pointer moves on.
    void selection.rangeCount;
  }
  return false;
}

let rootNode = null;
// What events pass above the root, outermost last: the document and the window of a DOM layer
// over the tree (`@silkui/core/globals`). Each has `_run(event, capture)` as a node does.
let outerTargets = [];
// Events the web does not send on to the document and the window.
const NOT_OUTER = new Set(["scroll", "layout", "load", "error"]);

/** Has events that reach the root go on to `targets` (outermost last), as `@silkui/core/globals` does for `document` and `window`. */
export function setOuterTargets(...targets) {
  outerTargets = targets;
}

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
      if (!(offset >= 0 && offset <= 1)) throw new Error(`@silkui/core: bad keyframe selector '${part}'`);
      native.keyframe(offset, css);
    }
  }
  native.keyframes(String(name));
}

export function mount(node) {
  if (rootNode) clearAdoptedSheets();
  rootNode = node;
  native.root(node.nodeId);
  syncAdoptedSheets();
  if (styleElements.size) stylesChanged();
  return node;
}

export function root() {
  return rootNode;
}

// The live regions `announce` speaks through, one per politeness, made on first use.
const regions = Object.create(null);
// A box screen readers read and nothing shows, as the web's visually hidden pattern.
const VISUALLY_HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  pointerEvents: "none",
};

/**
 * Has screen readers say `message` without showing it, as a toast or a "Saved" would. Polite
 * messages wait for the reader to finish; `{ politeness: "assertive" }` interrupts it. The
 * same message twice is said twice. Nothing happens before `mount`.
 */
export function announce(message, { politeness = "polite" } = {}) {
  if (!rootNode) return;
  const key = politeness === "assertive" ? "assertive" : "polite";
  let region = regions[key];
  if (!region || region.parentNode !== rootNode) {
    region = regions[key] = createBox(VISUALLY_HIDDEN);
    region.setAttribute("aria-live", key);
    region.setAttribute("aria-atomic", "true");
    rootNode.appendChild(region);
  }
  // A region announces changes, not what it holds when it appears, so the text waits a
  // moment; each message is a node of its own so a repeat is a change too.
  setTimeout(() => {
    if (region.parentNode !== rootNode) return;
    for (const child of region.childNodes.slice()) child.destroy();
    const text = createText(String(message));
    region.appendChild(text);
    setTimeout(() => {
      if (text.parentNode === region) text.destroy();
    }, ANNOUNCEMENT_LIFETIME);
  }, ANNOUNCEMENT_DELAY);
}

const ANNOUNCEMENT_DELAY = 100;
const ANNOUNCEMENT_LIFETIME = 7000;

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
const MODIFIER_FIELDS = { __proto__: null, Shift: "shiftKey", Control: "ctrlKey", Alt: "altKey", Meta: "metaKey" };

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

  /**
   * Whether modifier `key` ("Shift", "Control", "Alt", "Meta") was down, for keyboard, mouse,
   * pointer and touch events. Lock keys and others answer false.
   */
  getModifierState(key) {
    return this[MODIFIER_FIELDS[key]] === true;
  }

  /** The nodes the event passes, target first. */
  composedPath() {
    const path = [];
    for (let node = this.target; node; node = node.parentNode) path.push(node);
    if (outerTargets.length && path[path.length - 1] === rootNode && !NOT_OUTER.has(this.type)) path.push(...outerTargets);
    return path;
  }
}

// The pointers down or hovering, by `pointerId`: their buttons and the node holding their
// capture.
const pointers = new Map();

function domError(name, message) {
  const DOMExceptionClass = globalThis.DOMException;
  if (DOMExceptionClass) return new DOMExceptionClass(message, name);
  const error = new Error(message);
  error.name = name;
  return error;
}

const POINTER_TYPES = ["mouse", "pen", "touch"];
// DOM `buttons` bits by `button`: primary 1, secondary 2, auxiliary 4, back 8, forward 16.
const BUTTON_BITS = [1, 4, 2, 8, 16];

function isPointerKind(kind) {
  return kind <= 5 || kind === 14 || kind === 28 || kind === 29;
}

// The fingers down, by `identifier`: the `Touch` each last reported.
const touches = new Map();

function touchList(list) {
  list.item = (index) => list[index] ?? null;
  return list;
}

// A touch record as DOM `TouchEvent`: the finger it is about is `changedTouches[0]`, and it
// goes to the node the finger went down on. No host reports contact size or force: a touch is
// 1 by 1 pixel, as its pointer is, with force 0.
function fillTouch(event, kind, a, b, bits, d) {
  const identifier = Math.floor(bits / 256) % 16777216;
  const touch = {
    identifier,
    target: event.target,
    clientX: a,
    clientY: b,
    pageX: a,
    pageY: b,
    screenX: a,
    screenY: b,
    radiusX: 0.5,
    radiusY: 0.5,
    rotationAngle: 0,
    force: 0,
  };
  const start = touches.get(identifier);
  if (start) touch.target = start.target;
  if (kind === TOUCH_START || kind === TOUCH_START + 1) touches.set(identifier, touch);
  else touches.delete(identifier);
  event.cancelable = d === 1;
  event.changedTouches = touchList([touch]);
  event.touches = touchList([...touches.values()]);
  event.targetTouches = touchList([...touches.values()].filter((t) => t.target === event.target));
}

// The members of DOM `PointerEvent` the record carries (see ui-js-calls `pointerBits`), and the
// spec defaults for what no host reports: pressure 0.5 while a button is down, 0 otherwise, and
// a contact of 1 by 1 pixel with no tilt.
function fillPointer(event, kind, bits, d) {
  const pointerId = Math.floor(bits / 256) % 16777216;
  event._element = Math.floor(bits / 4294967296);
  const pointerType = POINTER_TYPES[Math.floor(bits / 16) % 4] ?? "mouse";
  const isPrimary = Math.floor(bits / 64) % 2 === 1;
  let pointer = pointers.get(pointerId);
  if (!pointer) {
    pointer = { buttons: 0, capture: null, primary: isPrimary, mute: false };
    // A click comes after its pointer lifted: it leaves no pointer behind.
    if (kind !== 2) pointers.set(pointerId, pointer);
  }
  if (kind === 0) pointer.buttons |= BUTTON_BITS[d] ?? 0;
  else if (kind === 1) pointer.buttons &= ~(BUTTON_BITS[d] ?? 0);
  event.pointerId = pointerId;
  event.pointerType = pointerType;
  event.isPrimary = isPrimary;
  event.buttons = pointer.buttons;
  event.pressure = pointer.buttons ? 0.5 : 0;
  event.tangentialPressure = 0;
  event.tiltX = 0;
  event.tiltY = 0;
  event.twist = 0;
  event.altitudeAngle = Math.PI / 2;
  event.azimuthAngle = 0;
  event.width = 1;
  event.height = 1;
  if (kind !== 0 && kind !== 1 && kind !== 2) event.button = kind === 3 ? -1 : 0;
  const coalesced = kind === 3 ? [event] : [];
  event.getCoalescedEvents = () => coalesced;
  event.getPredictedEvents = () => [];
  // A pointer that lifted, or a touch that left, is gone; the mouse stays.
  if ((kind === 1 && !pointer.buttons) || kind === 14) {
    pointer.capture = null;
    if (pointerType !== "mouse") pointers.delete(pointerId);
  }
}

function fill(event, kind, a, b, modifiers, d, e, first, second, third, fourth) {
  if (kind >= TOUCH_START && kind < COPY) {
    fillTouch(event, kind, a, b, modifiers, d);
    event.shiftKey = (modifiers & 1) !== 0;
    event.ctrlKey = (modifiers & 2) !== 0;
    event.altKey = (modifiers & 4) !== 0;
    event.metaKey = (modifiers & 8) !== 0;
    return;
  }
  if (kind <= 6 || kind === 14 || kind === 28 || kind === 29) {
    event.clientX = event.x = a;
    event.clientY = event.y = b;
  }
  if (isPointerKind(kind)) fillPointer(event, kind, modifiers, d);
  if (kind === 16) for (const pointer of pointers.values()) if (pointer.capture === event.target) pointer.capture = null;
  if (kind <= 8 || kind === 14 || kind === 28 || kind === 29) {
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
    event.pseudoElement = second ?? "";
  } else if (kind === 27) {
    event.target._selected?.(a, b, d);
    event.selectionStart = event.target.selectionStart;
    event.selectionEnd = event.target.selectionEnd;
  } else if (kind >= 23) {
    event.animationName = first;
    event.elapsedTime = a;
    event.pseudoElement = second ?? "";
  }
}

/**
 * Runs `event` through the tree as the DOM does: the capture phase from the root down, the
 * target, then the bubble phase back up for events that bubble. Returns false when a
 * listener prevented the default.
 */
export function dispatchEvent(event) {
  const path = [];
  for (let node = event.target; node; node = node.parentNode) path.push(node);
  if (outerTargets.length && path[path.length - 1] === rootNode && !NOT_OUTER.has(event.type)) path.push(...outerTargets);
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

// An event the app made, from the runtime's `Event` class: its target and phase become
// fields the dispatcher sets, and its stop methods record what the dispatcher reads.
function adopt(event, target) {
  if (!("_stopped" in event)) {
    let stopped = false;
    let immediate = false;
    const stop = event.stopPropagation;
    const stopNow = event.stopImmediatePropagation;
    Object.defineProperties(event, {
      _stopped: { get: () => stopped || event.cancelBubble === true, configurable: true },
      _immediate: { get: () => immediate, configurable: true },
      stopPropagation: { value() { stopped = true; stop?.call(event); }, configurable: true },
      stopImmediatePropagation: { value() { stopped = immediate = true; stopNow?.call(event); }, configurable: true },
    });
  }
  for (const [name, value] of [["target", target], ["currentTarget", null], ["eventPhase", 0]]) {
    if (Object.getOwnPropertyDescriptor(event, name)?.writable) event[name] = value;
    else Object.defineProperty(event, name, { value, writable: true, configurable: true });
  }
  return event;
}

// The compatibility mouse event of `type` that follows pointer event `from`.
function mouseEvent(type, from, target) {
  const event = new Event(type, target);
  for (const name of ["clientX", "clientY", "x", "y", "button", "buttons", "detail", "shiftKey", "ctrlKey", "altKey", "metaKey"]) {
    event[name] = from[name];
  }
  if (type === "mousemove") event.button = 0;
  return event;
}

// Mouse events after a pointer event of a mouse or pen, as the web sends them: a prevented
// `pointerdown` mutes `mousedown`, `mousemove` and `mouseup` until the pointer lifts.
function compatMouse(kind, event, target) {
  const type = MOUSE_OF.get(event.type);
  if (!type) return;
  const pointer = pointers.get(event.pointerId);
  if (kind === 0 && event.defaultPrevented && pointer) pointer.mute = true;
  const muted = pointer?.mute && (kind === 0 || kind === 1 || kind === 3);
  if (kind === 1 && pointer) pointer.mute = false;
  if (!muted && event.isPrimary) dispatchEvent(mouseEvent(type, event, target));
}

// The finger whose prevented `pointerdown` mutes its tap's mouse events.
let mutedTap = null;

// A tap's mouse events come just before its click, as on the web.
function compatTap(click, target) {
  if (mutedTap === click.pointerId) return;
  for (const type of ["mousemove", "mousedown", "mouseup"]) {
    const event = mouseEvent(type, click, target);
    event.buttons = type === "mousedown" ? 1 : 0;
    dispatchEvent(event);
  }
}

// The host calls this for every event record, before the tree runs the default action.
native.dispatch = function (kind, id, a, b, modifiers, d, e, first, second, third, fourth) {
  const target = nodes.get(id);
  if (!target) return false;
  if (kind >= CLOSE_REQUEST) return dispatchRequest(kind, target, a);
  if (kind >= COPY) return dispatchEditing(kind, target, first, second, third);
  if (kind === SELECTION_CHANGE && !(target instanceof Input)) return selectionRecord(target, a);
  if (kind === FOCUS) focusing(target);
  const event = new Event(TYPES[kind], target);
  fill(event, kind, a, b, modifiers, d, e, first, second, third, fourth);
  if (kind === FOCUS || kind === BLUR) event.relatedTarget = kind === FOCUS ? blurredNode : null;
  const live = target instanceof Svg && target._live && isPointerKind(kind);
  if (kind === CLICK && event.pointerType === "touch" && event.isPrimary) compatTap(event, target);
  // A live svg sends pointer records on to the element under the pointer.
  let prevented;
  if (live) prevented = target._pointer(event);
  else {
    dispatchEvent(event);
    prevented = event.defaultPrevented;
  }
  if (kind === FOCUS) {
    focusEvent("focusin", target, blurredNode);
    blurredNode = null;
  }
  else if (kind === BLUR) blurring(target);
  if (kind === CLICK && !prevented && !activate(target)) follow(target);
  if (kind !== CLICK && isPointerKind(kind)) {
    if (event.pointerType !== "touch") compatMouse(kind, event, live && event.target instanceof SvgElement ? event.target : target);
    // A finger's defaults (pan, focus, the tap's click) follow its touch events, not its
    // pointer events, as on the web.
    else {
      if (kind === 0 && event.isPrimary) mutedTap = prevented ? event.pointerId : null;
      return false;
    }
  }
  return prevented;
};

// The tree's requests, raised after an Escape, a back key or a back mouse button that nothing
// prevented: `closerequest` asks to close what is on top, as a web close watcher hears, and
// `navigate` asks to go back or forward, with `navigationType` "traverse" and `direction`
// "back" or "forward". The listener that acts stops the event; the tree does nothing itself.
function dispatchRequest(kind, target, forward) {
  const event = new Event(TYPES[kind], target);
  if (kind === NAVIGATE) {
    event.navigationType = "traverse";
    event.direction = forward ? "forward" : "back";
  }
  dispatchEvent(event);
  return event.defaultPrevented;
}

// Editing hosts, as the HTML Standard's contenteditable has them. The tree sends a focused
// host's typing, composition, deleting, line breaks and pastes as `beforeinput` records;
// unless a listener prevents one, `hostEdit` makes the change in the host's nodes, moves
// the selection after it and fires `input`, as a browser's editing does. Editors that keep
// their own model (ProseMirror) prevent what they handle and read the rest back from the
// nodes, through mutation observers.

// 1 for an editable `contenteditable` ("", "true", "plaintext-only"), 2 for "false", else 0.
function editableValue(node) {
  const value = node.nodeType === 1 ? node.getAttribute("contenteditable") : null;
  if (value === null) return 0;
  const lower = value.toLowerCase();
  return lower === "" || lower === "true" || lower === "plaintext-only" ? 1 : lower === "false" ? 2 : 0;
}

/** The editing host `node` is in (the outermost editable element up to a `contenteditable="false"`), or null. */
export function editingHostOf(node) {
  let host = null;
  for (let at = node; at; at = at.parentNode) {
    const value = editableValue(at);
    if (value === 2) return host;
    if (value === 1) host = at;
  }
  return host;
}

export class CompositionEvent extends Event {
  constructor(type, init = {}) {
    super(String(type), null);
    this.bubbles = init.bubbles ?? true;
    this.cancelable = !!init.cancelable;
    this.composed = init.composed ?? true;
    this.data = init.data ?? "";
  }
}

globalThis.CompositionEvent ??= CompositionEvent;

// Tags that start a block of their own, for joining and splitting paragraphs.
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "dd", "details", "div", "dl", "dt", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol",
  "p", "pre", "section", "summary", "table", "td", "th", "tr", "ul",
]);

function isBlock(node) {
  return node.nodeType === 1 && !(node instanceof LineBreak) && (BLOCK_TAGS.has(node.localName) || node.kind === "box" && node._tag === undefined);
}

// The block `node` is in, inside `host` (the host itself when there is none).
function blockIn(host, node) {
  for (let at = node; at && at !== host; at = at.parentNode) if (isBlock(at)) return at;
  return host;
}

// What the caret steps over: text, `<br>`s and elements with no children (images).
function isLeaf(node) {
  return node.nodeType === 3 ? node.length > 0 : node.nodeType === 1 && node.childNodes.length === 0 && !isBlock(node);
}

// The leaf before (or after) the point (`container`, `offset`) in tree order, inside `host`.
function leafBeside(host, container, offset, forward) {
  let node;
  if (container.nodeType === 3) node = container;
  else if (forward) {
    node = container.childNodes[offset];
    if (!node) node = following(container, host, true);
    else if (isLeaf(node)) return node;
  } else {
    node = container.childNodes[offset - 1];
    if (node) {
      while (node.lastChild) node = node.lastChild;
      if (isLeaf(node)) return node;
    } else node = container;
  }
  if (forward) {
    for (let at = node === container && container.nodeType === 3 ? following(node, host, true) : node; at; at = following(at, host)) {
      if (isLeaf(at)) return at;
    }
  } else {
    for (let at = preceding(node, host); at; at = preceding(at, host)) if (isLeaf(at)) return at;
  }
  return null;
}

// The node before `node` in tree order (its previous sibling's last descendant, or its
// parent), inside `within`.
function preceding(node, within) {
  if (node === within) return null;
  let at = node.previousSibling;
  if (!at) return node.parentNode === within ? null : node.parentNode;
  while (at.lastChild) at = at.lastChild;
  return at;
}

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter() : null;

// The UTF-16 offset of the grapheme boundary before (or after) `offset` in `text`.
function graphemeStep(text, offset, forward) {
  if (segmenter) {
    let last = 0;
    for (const { index } of segmenter.segment(text)) {
      if (forward && index > offset) return index;
      if (!forward && index >= offset) return last;
      last = index;
    }
    return forward ? text.length : last;
  }
  const code = forward ? text.charCodeAt(offset) : text.charCodeAt(offset - 1);
  const pair = forward ? code >= 0xd800 && code < 0xdc00 : code >= 0xdc00 && code < 0xe000;
  return forward ? Math.min(text.length, offset + (pair ? 2 : 1)) : Math.max(0, offset - (pair ? 2 : 1));
}

function wordStep(text, offset, forward) {
  if (forward) {
    const rest = /^\s*\S*/.exec(text.slice(offset))[0];
    return offset + Math.max(rest.length, 1);
  }
  const before = /\S*\s*$/.exec(text.slice(0, offset))[0];
  return offset - Math.max(before.length, 1);
}

// Makes (`node`, `offset`) a point between children: splits text there.
function elementPoint(node, offset) {
  if (node.nodeType !== 3) return [node, offset];
  const parent = node.parentNode;
  if (offset === 0) return [parent, indexIn(node)];
  if (offset < node.length) node.splitText(offset);
  return [parent, indexIn(node) + 1];
}

// Gives an empty block a `<br>`, so it keeps a line for the caret.
function keepLine(block) {
  for (let at = block.firstChild; at; at = following(at, block)) if (isLeaf(at)) return;
  block.appendChild(new LineBreak());
}

// Moves `from`'s content to the end of `into` and removes `from`, as deleting the boundary
// between two paragraphs does. Returns the point where they met.
function joinBlocks(into, from) {
  onlyBreak(into)?.remove();
  if (leafBeside(into, into, 0, true)) onlyBreak(from)?.remove();
  const point = into.lastChild?.nodeType === 3 ? [into.lastChild, into.lastChild.length] : [into, into.childNodes.length];
  while (from.firstChild) into.appendChild(from.firstChild);
  from.remove();
  return point;
}

// The `<br>` that alone gives `block` its line, if that is all it holds.
function onlyBreak(block) {
  let found = null;
  for (let at = block.firstChild; at; at = following(at, block)) {
    if (!isLeaf(at)) continue;
    if (found || !(at instanceof LineBreak)) return null;
    found = at;
  }
  return found;
}

// Splits `block` at (`node`, `offset`): what follows goes to a copy of the block (and of each
// element on the way) after it. Returns the copy.
function splitBlock(block, node, offset) {
  let [level, at] = elementPoint(node, offset);
  let carried = null;
  for (;;) {
    const copy = level.cloneNode(false);
    if (carried) copy.appendChild(carried);
    while (level.childNodes.length > at) copy.appendChild(level.childNodes[at]);
    if (level === block) {
      block.parentNode.insertBefore(copy, block.nextSibling);
      keepLine(block);
      keepLine(copy);
      return copy;
    }
    carried = copy;
    at = indexIn(level) + 1;
    level = level.parentNode;
  }
}

// The first point in text (or the start) inside `node`.
function startIn(node) {
  for (let at = node; at; at = following(at, node)) {
    if (at.nodeType === 3) return [at, 0];
    if (at instanceof LineBreak) return [at.parentNode, indexIn(at)];
  }
  return [node, 0];
}

// Inserts `text` at the collapsed point (`node`, `offset`); returns the point after it.
// Line breaks in it become `<br>`s.
function insertText(node, offset, text) {
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      [node, offset] = elementPoint(node, offset);
      node.insertBefore(new LineBreak(), node.childNodes[offset] ?? null);
      offset += 1;
    }
    const line = lines[i];
    if (!line) continue;
    if (node.nodeType === 3) {
      node.insertData(offset, line);
      offset += line.length;
      continue;
    }
    const before = node.childNodes[offset - 1];
    const after = node.childNodes[offset];
    if (before?.nodeType === 3) {
      const at = before.length;
      before.appendData(line);
      [node, offset] = [before, at + line.length];
    } else if (after?.nodeType === 3) {
      after.insertData(0, line);
      [node, offset] = [after, line.length];
    } else {
      const created = new Text(line);
      node.insertBefore(created, after ?? null);
      [node, offset] = [created, line.length];
    }
  }
  return [node, offset];
}

// Deletes what `range` covers; paragraphs it crossed into become one. Returns the point
// where the deleted content was.
function deleteRange(host, range) {
  const startBlock = blockIn(host, range.startContainer);
  const endBlock = blockIn(host, range.endContainer);
  range.deleteContents();
  let point = [range.startContainer, range.startOffset];
  if (startBlock !== endBlock && startBlock.isConnected !== false && endBlock.parentNode && host.contains(endBlock) && host.contains(startBlock)) {
    point = joinBlocks(startBlock, endBlock);
  }
  if (startBlock !== host) keepLine(startBlock);
  return point;
}

// Deletes one step (a grapheme, a word, to the line's edge) before or after the caret.
function deleteStep(host, node, offset, forward, unit) {
  if (node.nodeType === 3 && (forward ? offset < node.length : offset > 0)) {
    const data = node.data;
    const to = unit === "word" ? wordStep(data, offset, forward)
      : unit === "line" ? (forward ? data.length : 0)
        : graphemeStep(data, offset, forward);
    const start = Math.min(offset, to);
    node.deleteData(start, Math.abs(to - offset));
    const block = blockIn(host, node);
    if (block !== host) keepLine(block);
    return [node, start];
  }
  const leaf = leafBeside(host, node, offset, forward);
  if (!leaf) return [node, offset];
  const here = blockIn(host, node);
  const there = blockIn(host, leaf);
  if (here === there || here === host || there === host) {
    if (leaf.nodeType === 3) return deleteStep(host, leaf, forward ? 0 : leaf.length, forward, unit);
    const parent = leaf.parentNode;
    const index = indexIn(leaf);
    leaf.remove();
    if (here !== host) keepLine(here);
    return [parent, index];
  }
  return forward ? joinBlocks(here, there) : joinBlocks(there, here);
}

const compositions = new WeakMap();

function editEvent(type, host, inputType, data, isComposing, cancelable = true) {
  const event = new InputEvent(type, { bubbles: true, cancelable, composed: true, inputType, data, isComposing });
  event.target = host;
  dispatchEvent(event);
  return event;
}

function compositionEvent(type, host, data) {
  const event = new CompositionEvent(type, { data });
  event.target = host;
  dispatchEvent(event);
}

// The edit `inputType` with `data` that the tree asked of `host`. Returns whether a listener
// prevented it.
function hostEdit(host, inputType, data) {
  const plain = editableValue(host) === 1 && host.getAttribute("contenteditable").toLowerCase() === "plaintext-only";
  const selection = getSelection();
  let range = selection.rangeCount ? selection.getRangeAt(0) : null;
  if (range && (!host.contains(range.startContainer) || !host.contains(range.endContainer))) range = null;
  const composing = compositions.get(host);

  if (inputType === "insertCompositionText" || composing && inputType === "insertText") {
    if (!composing && !data) return false;
    let start;
    if (!composing) {
      compositionEvent("compositionstart", host, range ? range.toString() : "");
      if (!range) return false;
      start = range.collapsed ? [range.startContainer, range.startOffset] : deleteRange(host, range);
    } else {
      start = [composing.node, composing.offset];
    }
    const committing = inputType === "insertText";
    if (!committing) compositionEvent("compositionupdate", host, data);
    editEvent("beforeinput", host, committing ? "insertFromComposition" : "insertCompositionText", data, !committing, false);
    let [node, offset] = start;
    if (composing && composing.node.isConnected !== false && composing.node.nodeType === 3) {
      composing.node.deleteData(composing.offset, Math.min(composing.length, composing.node.length - composing.offset));
    }
    const end = data ? insertText(node, offset, data) : [node, offset];
    // Text inserted into an element point lands in a text node: the composition starts there.
    if (node.nodeType !== 3 && end[0].nodeType === 3) [node, offset] = [end[0], end[1] - data.length];
    selection.collapse(end[0], end[1]);
    editEvent("input", host, committing ? "insertFromComposition" : "insertCompositionText", data, !committing, false);
    if (committing || !data) {
      compositions.delete(host);
      compositionEvent("compositionend", host, data);
    } else {
      compositions.set(host, { node, offset, length: data.length });
    }
    return false;
  }

  const event = editEvent("beforeinput", host, inputType, data || null, false);
  if (event.defaultPrevented || !range) return event.defaultPrevented;
  let point;
  const collapsed = range.collapsed;
  switch (inputType) {
    case "insertText":
    case "insertReplacementText":
    case "insertFromPaste":
    case "insertFromDrop": {
      point = collapsed ? [range.startContainer, range.startOffset] : deleteRange(host, range);
      point = insertText(point[0], point[1], data);
      break;
    }
    case "insertLineBreak":
    case "insertParagraph": {
      point = collapsed ? [range.startContainer, range.startOffset] : deleteRange(host, range);
      const block = blockIn(host, point[0]);
      if (inputType === "insertParagraph" && !plain && block !== host) {
        point = startIn(splitBlock(block, point[0], point[1]));
      } else {
        const [parent, index] = elementPoint(point[0], point[1]);
        parent.insertBefore(new LineBreak(), parent.childNodes[index] ?? null);
        // A break that ends its block needs another after it for the new line to show.
        if (!leafBeside(block, parent, index + 1, true)) parent.insertBefore(new LineBreak(), parent.childNodes[index + 1] ?? null);
        point = [parent, index + 1];
      }
      break;
    }
    case "deleteByCut":
    case "deleteByDrag":
    case "deleteContent":
      if (collapsed) return false;
      point = deleteRange(host, range);
      break;
    default: {
      const match = /^delete(Content|Word|SoftLine|HardLine)(Backward|Forward)$/.exec(inputType);
      if (!match) return false;
      if (!collapsed) point = deleteRange(host, range);
      else {
        const unit = match[1] === "Content" ? "grapheme" : match[1] === "Word" ? "word" : "line";
        point = deleteStep(host, range.startContainer, range.startOffset, match[2] === "Forward", unit);
      }
    }
  }
  selection.collapse(point[0], point[1]);
  editEvent("input", host, inputType, data || null, false, false);
  return false;
}

/**
 * The classic editing commands an editor may still call: `insertText`, `delete`,
 * `forwardDelete`, `insertParagraph`, `insertLineBreak` and `selectAll`, in the focused
 * editing host. Returns whether it ran.
 */
export function execCommand(command, _showUI = false, value = "") {
  const selection = getSelection();
  const node = selection.rangeCount ? selection.getRangeAt(0).startContainer : null;
  const host = node ? editingHostOf(node) : null;
  if (!host) return false;
  if (command === "selectAll") {
    selection.selectAllChildren(host);
    return true;
  }
  const inputType = { insertText: "insertText", delete: "deleteContentBackward", forwardDelete: "deleteContentForward", insertParagraph: "insertParagraph", insertLineBreak: "insertLineBreak", insertHTML: "insertText" }[command];
  if (!inputType) return false;
  hostEdit(host, inputType, inputType === "insertText" ? String(value) : "");
  return true;
}

// Copy, cut and paste as the Clipboard API and events spec has them, and beforeinput. A
// paste carries the clipboard's text, HTML and a PNG (bytes as a Latin-1 string). A copy or
// cut a listener prevented puts what it set on `clipboardData` on the clipboard; one it did
// not prevent lets the tree copy the selection.
function dispatchEditing(kind, target, first, second, third) {
  if (kind === BEFORE_INPUT && !(target instanceof Input) && editingHostOf(target) === target) return hostEdit(target, second ?? "", first ?? "");
  let event;
  if (kind === BEFORE_INPUT) {
    event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: second ?? "", data: first ?? "" });
  } else {
    const data = new DataTransfer();
    if (kind === PASTE) {
      if (first) data.setData("text/plain", first);
      if (second) data.setData("text/html", second);
      if (third) data.items.add(new FileClass([bytesOf(third)], "image.png", { type: "image/png" }));
      data._mode = "readonly";
    }
    event = new ClipboardEvent(TYPES[kind], { bubbles: true, cancelable: true, composed: true, clipboardData: data });
  }
  event.target = target;
  dispatchEvent(event);
  if (event.clipboardData) {
    if ((kind === COPY || kind === CUT) && event.defaultPrevented) writeClipboard(event.clipboardData);
    event.clipboardData._mode = "protected";
  }
  return event.defaultPrevented;
}

const bytesOf = (text) => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
};

// What a prevented copy or cut set, onto the system clipboard.
function writeClipboard(data) {
  const clipboard = globalThis.navigator?.clipboard;
  const entries = data._entries();
  if (!clipboard || entries.length === 0) return;
  const item = {};
  for (const [type, value] of entries) item[type] = value;
  const written = entries.length === 1 && entries[0][0] === "text/plain" || typeof globalThis.ClipboardItem !== "function"
    ? clipboard.writeText(item["text/plain"] ?? "")
    : clipboard.write([new globalThis.ClipboardItem(item)]);
  Promise.resolve(written).catch(reportError);
}

// The focused node, as far as focus and blur records tell (HTML elements that can take focus
// listen for both: see `createElement`).
let focusedNode = null;
// The node a blur record left, until the focus record that follows it.
let blurredNode = null;
let pendingFocusOut = null;

/** The focused node, or null. */
export function activeElement() {
  return focusedNode?.parentNode || focusedNode === rootNode ? focusedNode : null;
}

function focusEvent(type, target, relatedTarget) {
  const event = new Event(type, target);
  event.bubbles = true;
  event.relatedTarget = relatedTarget;
  dispatchEvent(event);
}

// `focusout` waits for the focus record that follows a blur, so its `relatedTarget` is where
// focus went, as on the web; with none, it goes out on its own.
function blurring(target) {
  if (focusedNode === target) focusedNode = null;
  blurredNode = target;
  pendingFocusOut = target;
  queueMicrotask(() => {
    if (pendingFocusOut !== target) return;
    pendingFocusOut = null;
    blurredNode = null;
    focusEvent("focusout", target, null);
  });
}

function focusing(target) {
  focusedNode = target;
  const left = pendingFocusOut;
  pendingFocusOut = null;
  if (left) focusEvent("focusout", left, target);
  else blurredNode = null;
}

// HTML defaults of a click: a checkbox or radio checks, a label passes the click on to its
// control, a summary opens its details, a submit button submits its form. True when one ran.
function activate(target) {
  for (let node = target; node; node = node.parentNode) {
    if (node._activate) return node._activate() !== false;
    if (node._href) return false;
  }
  return false;
}

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
  importedSheets.clear();
  styleElements.clear();
  appliedStyles = [];
  for (const node of [...nodes.values()]) if (!node.parentNode && nodes.has(node.nodeId)) node.destroy();
  rootNode = null;
};

// The host calls this after it handled an input: an exception a listener threw surfaces here.
native.takeError = function () {
  if (!pendingError) return;
  const { error } = pendingError;
  pendingError = null;
  throw error;
};

// The desktop around the window: files dragged in from other apps, notifications, the tray
// and global shortcuts. The host serves `__ui.shell` calls after the code that made them has
// run and answers through `__ui.shellAnswer`; desktop events arrive through `__ui.shellEvent`.

const shellCalls = new Map();
let nextShellCall = 0;

function shellCall(op, fields) {
  const call = ++nextShellCall;
  return new Promise((resolve) => {
    shellCalls.set(call, resolve);
    native.shell(call, op, fields.join("\x1f"));
  });
}

native.shellAnswer = function (call, value) {
  const resolve = shellCalls.get(call);
  if (!resolve) return;
  shellCalls.delete(call);
  resolve(value);
};

/** A file dragged in from the desktop, as the web's `File`, with its `path` on disk. */
export class DroppedFile {
  constructor(path) {
    this.path = path;
    this.name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    this.type = "";
  }
}

// `File` where the runtime has one, else a `Blob` with a name.
const FileClass = globalThis.File ?? (globalThis.Blob ? class File extends globalThis.Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = String(name);
    this.lastModified = options.lastModified ?? Date.now();
  }
} : null);

const normalFormat = (format) => {
  const lower = String(format).toLowerCase();
  return lower === "text" ? "text/plain" : lower === "url" ? "text/uri-list" : lower;
};

/** One entry of a `DataTransfer`, as the web's `DataTransferItem`. */
class DataTransferItem {
  #owner;
  #value;
  constructor(owner, kind, type, value) {
    this.#owner = owner;
    this.kind = kind;
    this.type = type;
    this.#value = value;
  }

  getAsString(callback) {
    if (this.kind !== "string" || typeof callback !== "function" || this.#owner._mode === "protected") return;
    const value = this.#value;
    queueMicrotask(() => callback(value));
  }

  getAsFile() {
    return this.kind === "file" && this.#owner._mode !== "protected" ? this.#value : null;
  }

  _value() {
    return this.#value;
  }
}

/** The entries of a `DataTransfer`, as the web's `DataTransferItemList`. */
class DataTransferItemList {
  #owner;
  #list = [];
  constructor(owner) {
    this.#owner = owner;
    return new Proxy(this, {
      get: (self, key) => {
        if (typeof key === "string" && /^\d+$/.test(key)) return self.length > Number(key) ? self.#list[Number(key)] : undefined;
        const value = Reflect.get(self, key, self);
        return typeof value === "function" ? value.bind(self) : value;
      },
    });
  }

  get length() {
    return this.#owner._mode === "protected" ? 0 : this.#list.length;
  }

  /** `add(data, type)` for a string, `add(file)` for a file. Read-only data throws. */
  add(data, type) {
    this.#owner._writable();
    if (typeof data === "string") {
      const format = normalFormat(type ?? "");
      if (this.#list.some((item) => item.kind === "string" && item.type === format)) {
        throw domError("NotSupportedError", "The data already holds an item of type " + format);
      }
      const item = new DataTransferItem(this.#owner, "string", format, data);
      this.#list.push(item);
      return item;
    }
    if (data && typeof data === "object") {
      const item = new DataTransferItem(this.#owner, "file", String(data.type ?? "").toLowerCase(), data);
      this.#list.push(item);
      return item;
    }
    throw new TypeError("DataTransferItemList.add takes a string and a type, or a File");
  }

  remove(index) {
    this.#owner._writable();
    if (index >= 0 && index < this.#list.length) this.#list.splice(index, 1);
  }

  clear() {
    this.#owner._writable();
    this.#list.length = 0;
  }

  [Symbol.iterator]() {
    return (this.#owner._mode === "protected" ? [] : this.#list)[Symbol.iterator]();
  }

  _all() {
    return this.#list;
  }
}

/**
 * What a copy, cut, paste or file drag carries, as the web's `DataTransfer`. `new
 * DataTransfer()` is empty and writable. A file drag lists the dragged `paths` in `files`;
 * its `types` is `["Files"]` while they are over the window.
 */
export class DataTransfer {
  #items;
  constructor(paths) {
    // "readwrite", "readonly" (paste, drop) or "protected" (after the event).
    this._mode = "readwrite";
    this._drag = Array.isArray(paths);
    paths ??= [];
    this.#items = new DataTransferItemList(this);
    for (const path of paths) this.#items.add(new DroppedFile(path));
    this.dropEffect = paths.length ? "copy" : "none";
    this.effectAllowed = paths.length ? "copy" : "uninitialized";
  }

  _writable() {
    if (this._mode !== "readwrite") throw domError("InvalidStateError", "The DataTransfer is read-only now");
  }

  get items() {
    return this.#items;
  }

  get types() {
    if (this._mode === "protected") return Object.freeze([]);
    const types = [];
    let files = false;
    for (const item of this.#items._all()) {
      if (item.kind === "string") types.push(item.type);
      else files = true;
    }
    if (files || this._drag) types.push("Files");
    return Object.freeze(types);
  }

  get files() {
    if (this._mode === "protected") return Object.freeze([]);
    return Object.freeze(this.#items._all().filter((item) => item.kind === "file").map((item) => item._value()));
  }

  getData(format) {
    if (this._mode === "protected") return "";
    const type = normalFormat(format);
    const item = this.#items._all().find((each) => each.kind === "string" && each.type === type);
    const value = item ? item._value() : "";
    return type === "text/uri-list" ? (value.split(/\r?\n/).find((line) => line && !line.startsWith("#")) ?? "") : value;
  }

  setData(format, data) {
    if (this._mode !== "readwrite") return;
    const type = normalFormat(format);
    const list = this.#items._all();
    const at = list.findIndex((each) => each.kind === "string" && each.type === type);
    if (at >= 0) list.splice(at, 1);
    this.#items.add(String(data), type);
  }

  clearData(format) {
    if (this._mode !== "readwrite") return;
    const list = this.#items._all();
    const type = format === undefined ? null : normalFormat(format);
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].kind === "string" && (type === null || list[i].type === type)) list.splice(i, 1);
    }
  }

  setDragImage() {}

  // The strings, and the PNG files, to put on the clipboard.
  _entries() {
    const entries = [];
    for (const item of this.#items._all()) {
      if (item.kind === "string") entries.push([item.type, item._value()]);
      else if (item.type === "image/png" && !entries.some(([type]) => type === "image/png")) entries.push(["image/png", item._value()]);
    }
    return entries;
  }
}

/** A copy, cut or paste, as the web's `ClipboardEvent`. */
export class ClipboardEvent extends Event {
  constructor(type, init = {}) {
    super(String(type), null);
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.composed = !!init.composed;
    this.clipboardData = init.clipboardData ?? null;
  }
}

/** An edit about to happen (`beforeinput`), as the web's `InputEvent`. */
class InputEvent extends Event {
  constructor(type, init = {}) {
    super(String(type), null);
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.composed = !!init.composed;
    this.inputType = init.inputType ?? "";
    this.data = init.data ?? null;
    this.dataTransfer = init.dataTransfer ?? null;
    this.isComposing = !!init.isComposing;
  }

  getTargetRanges() {
    return [];
  }
}

globalThis.ClipboardEvent ??= ClipboardEvent;
globalThis.InputEvent ??= InputEvent;
globalThis.DataTransfer ??= DataTransfer;

let dragTarget = null;

function dragEvent(type, target, x, y, paths) {
  const event = new Event(type, target);
  event.clientX = event.x = x;
  event.clientY = event.y = y;
  event.dataTransfer = new DataTransfer(paths);
  dispatchEvent(event);
}

// As the web: `dragenter` on the node now under the files, `dragleave` on the one before,
// then `dragover` on the current one.
function dragTo(target, x, y) {
  if (target !== dragTarget) {
    const before = dragTarget;
    dragTarget = target;
    if (target) dragEvent("dragenter", target, x, y, []);
    if (before) dragEvent("dragleave", before, x, y, []);
  }
  if (target) dragEvent("dragover", target, x, y, []);
}

// Menu item callbacks by action id. Each menu (the tray's, the app's, a context menu) owns
// the ids it packed, and drops them when it is replaced or closes.
const menuActions = new Map();
const menuOwners = { tray: [], app: [], context: [] };
let nextMenuAction = 0;
let trayClick = null;
const shortcuts = new Map();
const shortcutIds = new Map();
let nextShortcut = 0;
const notifications = new Map();

native.shellEvent = function (kind, a, x, y, text) {
  if (kind <= 3) {
    const target = nodes.get(a) ?? rootNode;
    if (kind === 2) {
      const before = dragTarget;
      dragTarget = null;
      if (before) dragEvent("dragleave", before, x, y, []);
    } else if (kind === 3) {
      if (target !== dragTarget) dragTo(target, x, y);
      dragTarget = null;
      if (target) dragEvent("drop", target, x, y, text ? text.split("\n") : []);
    } else {
      dragTo(target, x, y);
    }
  } else if (kind === 4) {
    shortcuts.get(a)?.();
  } else if (kind === 5) {
    trayClick?.({ button: a });
  } else if (kind === 6) {
    const run = menuActions.get(a);
    if (menuOwners.context.includes(a)) closeContextMenu();
    run?.();
  } else if (kind === 7) {
    const notification = notifications.get(a);
    if (!notification) return;
    notifications.delete(a);
    notification._fire("click");
  } else if (kind === 8) {
    const resolve = dialogs.get(a);
    if (!resolve) return;
    dialogs.delete(a);
    resolve(text ? text.split("\n") : []);
  } else if (kind === 9) {
    closeContextMenu();
  } else if (kind === 10) {
    const fullScreen = a === 1;
    if (fullScreen === appWindow.fullScreen) return;
    appWindow.fullScreen = fullScreen;
    appWindow._fire("fullscreenchange", { fullScreen });
  } else if (kind === 11) {
    if (a === appWindow.zoomFactor) return;
    appWindow.zoomFactor = a;
    appWindow._fire("zoomchange", { zoomFactor: a });
  } else if (kind === WEB_VIEW_EVENT) {
    webViewEvent(a, x, text);
  }
};

// Notifications nobody clicked are forgotten after this many newer ones.
const NOTIFICATIONS_KEPT = 64;

/**
 * A desktop notification, as the web's: `new Notification(title, { body })`, with `onclick`
 * or a `click` listener. Permission is always granted.
 */
export class Notification {
  static permission = "granted";

  static requestPermission(callback) {
    callback?.("granted");
    return Promise.resolve("granted");
  }

  #listeners = new Map();

  constructor(title, options = {}) {
    this.title = String(title);
    this.body = String(options.body ?? "");
    this.tag = String(options.tag ?? "");
    this.data = options.data ?? null;
    this.onclick = this.onshow = this.onerror = this.onclose = null;
    shellCall(0, [this.title, this.body]).then((id) => {
      if (!id) return this._fire("error");
      notifications.set(id, this);
      if (notifications.size > NOTIFICATIONS_KEPT) notifications.delete(notifications.keys().next().value);
      this._fire("show");
    });
  }

  /** The system keeps the notification until the user dismisses it. */
  close() {}

  addEventListener(type, listener) {
    let list = this.#listeners.get(type);
    if (!list) this.#listeners.set(type, (list = []));
    if (!list.includes(listener)) list.push(listener);
  }

  removeEventListener(type, listener) {
    const list = this.#listeners.get(type);
    const index = list ? list.indexOf(listener) : -1;
    if (index >= 0) list.splice(index, 1);
  }

  _fire(type) {
    const event = { type, target: this, currentTarget: this };
    const handler = this["on" + type];
    try {
      if (typeof handler === "function") handler.call(this, event);
      for (const listener of (this.#listeners.get(type) ?? []).slice()) listener.call(this, event);
    } catch (error) {
      reportError(error);
    }
  }
}

globalThis.Notification ??= Notification;
globalThis.AbstractRange ??= AbstractRange;
globalThis.StaticRange ??= StaticRange;
globalThis.Range ??= Range;
globalThis.DocumentFragment ??= DocumentFragment;

function hex(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return text;
}

// The roles the system implements, by `SystemItem` index; `about` and the others the
// platform has no counterpart for are left out there.
const SYSTEM_ROLES = {
  about: 0, services: 1, hide: 2, hideothers: 3, unhide: 4, quit: 5, close: 6, minimize: 7, zoom: 8,
  togglefullscreen: 9, front: 10, undo: 11, redo: 12, cut: 13, copy: 14, paste: 15, selectall: 16,
};

// Roles JavaScript does itself, with their usual labels and shortcuts.
const SCRIPT_ROLES = {
  resetzoom: { label: "Actual Size", accelerator: "Mod+0", click: () => appWindow.setZoomFactor(1) },
  zoomin: { label: "Zoom In", accelerator: "Mod+Plus", click: () => appWindow.setZoomFactor(zoomStep(1)) },
  zoomout: { label: "Zoom Out", accelerator: "Mod+-", click: () => appWindow.setZoomFactor(zoomStep(-1)) },
};

// Roles that stand for a whole menu, as Electron's.
const MENU_ROLES = {
  appmenu: () => [{ role: "about" }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }],
  filemenu: () => [{ role: IS_MAC ? "close" : "quit" }],
  editmenu: () => [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
  viewmenu: () => [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
  windowmenu: () => [{ role: "minimize" }, { role: "zoom" }, ...(IS_MAC ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }])],
};

const IS_MAC = /mac/i.test(globalThis.navigator?.platform ?? "") || globalThis.process?.platform === "darwin";

// A menu shortcut as the host reads it: "" for none, else the key (`c` and a character, `n`
// and a key name) and the modifier bits.
function packAccelerator(accelerator) {
  if (!accelerator) return ",0";
  const parts = String(accelerator).split("+").map((part) => part.trim());
  // "Mod+Plus" and "Mod++" both name the plus key.
  if (parts.at(-1) === "" && parts.at(-2) === "") parts.splice(-2, 2, "+");
  let bits = 0;
  let key = "";
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier !== undefined) bits |= modifier;
    else if (part) key = part;
  }
  const lower = key.toLowerCase();
  const named = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", esc: "Escape", escape: "Escape", return: "Enter", enter: "Enter", tab: "Tab", backspace: "Backspace", delete: "Delete", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown" }[lower];
  if (named) return "n" + named + "," + bits;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return "nF" + lower.slice(1) + "," + bits;
  if (lower === "plus") return "c+," + bits;
  if (lower === "space") return "c ," + bits;
  if ([...key].length === 1) return "c" + lower + "," + bits;
  return "," + bits;
}

// `items` as the host's menu lines, with their callbacks kept under `owner`.
function packMenu(items, lines, owner) {
  for (const item of items) {
    if (!item || item.visible === false) continue;
    const role = String(item.role ?? "").toLowerCase();
    if (item.type === "separator") lines.push("S");
    else if (MENU_ROLES[role] && !item.submenu) {
      lines.push("B" + String(item.label ?? role.replace(/menu$/, "").replace(/^./, (c) => c.toUpperCase())).replace(/\n/g, " "));
      packMenu(MENU_ROLES[role](), lines, owner);
      lines.push("E");
    } else if (item.submenu) {
      lines.push("B" + String(item.label ?? "").replace(/\n/g, " "));
      packMenu(item.submenu, lines, owner);
      lines.push("E");
    } else if (SYSTEM_ROLES[role] !== undefined && !item.click) {
      lines.push("R" + SYSTEM_ROLES[role]);
    } else {
      const known = SCRIPT_ROLES[role] ?? {};
      const action = ++nextMenuAction;
      const click = item.click ?? known.click;
      menuActions.set(action, typeof click === "function" ? () => click(item) : () => {});
      menuOwners[owner].push(action);
      const label = String(item.label ?? known.label ?? "").replace(/\n/g, " ");
      lines.push("A" + action + "," + (item.enabled === false ? 0 : 1) + "," + (item.checked ? 1 : 0) + "," + packAccelerator(item.accelerator ?? known.accelerator) + "," + label);
    }
  }
}

function dropMenu(owner) {
  for (const action of menuOwners[owner]) menuActions.delete(action);
  menuOwners[owner] = [];
}

/**
 * Shows an icon in the system tray (the macOS menu bar, the Windows notification area, a
 * StatusNotifierItem on Linux). `icon` is RGBA pixels, as an `ImageData`: `{ width, height,
 * data }`; macOS draws a `template` icon from its alpha in the menu bar's colours. `menu`
 * items are `{ label, click, enabled, checked }`, `{ type: "separator" }` or `{ label,
 * submenu }`. With no menu, `onClick({ button })` runs when the icon is clicked. Calling it
 * again replaces the tray. Resolves to whether the system shows it.
 */
export function setTray({ icon, tooltip = "", template = false, menu = [], onClick = null }) {
  if (!icon || !(icon.width > 0) || !(icon.height > 0) || icon.data?.length !== icon.width * icon.height * 4) {
    throw new TypeError("setTray needs an icon of RGBA pixels: { width, height, data }");
  }
  dropMenu("tray");
  trayClick = typeof onClick === "function" ? onClick : null;
  const lines = [];
  packMenu(menu, lines, "tray");
  const fields = [String(tooltip), icon.width, icon.height, template ? 1 : 0, hex(icon.data), lines.join("\n")];
  return shellCall(1, fields).then((shown) => shown === 1);
}

/** Takes the tray icon away. */
export function removeTray() {
  dropMenu("tray");
  trayClick = null;
  shellCall(2, []);
}

const MODIFIERS = { shift: 1, ctrl: 2, control: 2, alt: 4, option: 4, meta: 8, cmd: 8, command: 8, super: 8, mod: 16, cmdorctrl: 16, commandorcontrol: 16 };
const KEY_NAMES = {
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", esc: "Escape", return: "Enter",
  space: " ", plus: "Equal", "=": "Equal", "-": "Minus", ",": "Comma", ".": "Period", "/": "Slash",
  ";": "Semicolon", "'": "Quote", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "`": "Backquote",
};

// "Mod+Shift+K" as the UI Events `code` of the key and the modifier bits; `Mod` (also
// `CmdOrCtrl`) is Command on macOS and Control elsewhere.
function parseShortcut(accelerator) {
  const parts = String(accelerator).split("+").map((part) => part.trim()).filter(Boolean);
  let bits = 0;
  let code = "";
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier !== undefined) {
      bits |= modifier;
      continue;
    }
    const named = KEY_NAMES[part.toLowerCase()] ?? part;
    if (named === " ") code = "Space";
    else if (/^[a-z]$/i.test(named)) code = "Key" + named.toUpperCase();
    else if (/^[0-9]$/.test(named)) code = "Digit" + named;
    else code = named[0].toUpperCase() + named.slice(1);
  }
  if (!code) throw new TypeError("'" + accelerator + "' names no key");
  return { code, bits };
}

/**
 * Runs `callback` when the keys of `accelerator` are pressed, whichever app has focus:
 * `"Mod+Shift+K"`, where `Mod` is Command on macOS and Control elsewhere, and the key is a
 * letter, a digit, a UI Events `code` (`"F5"`, `"ArrowUp"`, `"Slash"`) or a name such as
 * `Space` or `Esc`. Registering it again replaces the callback. Resolves to whether the
 * system took it: another app may hold it, and Wayland has no global shortcuts.
 */
export function registerShortcut(accelerator, callback) {
  const { code, bits } = parseShortcut(accelerator);
  const key = code + "+" + bits;
  let id = shortcutIds.get(key);
  if (id === undefined) shortcutIds.set(key, (id = ++nextShortcut));
  shortcuts.set(id, callback);
  return shellCall(3, [id, code, bits]).then((held) => held === 1);
}

// Web views: a real browser page (WKWebView on macOS) shown over a node, which a person and
// an agent can both use. The views live on the platform thread; calls go through `__ui.shell`
// (ops 10 to 14) and their events come back through `__ui.shellEvent` kind 20, with the view,
// an event code and the fields separated by U+001F (ui-webview's wire.silk).

const WEB_VIEW_EVENT = 20;
const webViews = new Map();
let nextWebView = 0;
let nextWebRequest = 0;
const webRequests = new Map();
const dataClears = new Map();

const thousandths = (value) => String(Math.round(Number(value) * 1000));

function webRequest(resolve, reject) {
  const request = ++nextWebRequest;
  webRequests.set(request, { resolve, reject });
  return request;
}

function settleWebRequest(request, ok, value, error) {
  const waiting = webRequests.get(request);
  if (!waiting) return;
  webRequests.delete(request);
  if (ok) waiting.resolve(value);
  else waiting.reject(error instanceof Error ? error : new Error(String(error)));
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Uint8Array(128);
for (let i = 0; i < BASE64.length; i++) BASE64_VALUES[BASE64.charCodeAt(i)] = i;

function decodeBase64(text) {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let count = 0;
  let at = 0;
  for (let i = 0; i < clean.length; i++) {
    bits = (bits << 6) | BASE64_VALUES[clean.charCodeAt(i)];
    count += 6;
    if (count >= 8) {
      count -= 8;
      out[at++] = (bits >> count) & 255;
    }
  }
  return out;
}

const CONSOLE_LEVELS = ["debug", "log", "info", "warning", "error"];

/** An event of a {@link WebView}: its `type` and the fields of what happened. */
export class WebViewEvent {
  constructor(type, fields) {
    this.type = type;
    Object.assign(this, fields);
  }
}

/**
 * A web view: a real browser page shown over a node. The page draws over the node's box
 * (a native view of the system's engine), follows it as layout moves it, and hides when the
 * node is not shown. Make one with {@link createWebView}.
 *
 * The view keeps the page's state as it reports it: `url`, `title`, `favicon`, `loading`,
 * `progress`, `canGoBack`, `canGoForward`, `focused`. Listen with `addEventListener(type,
 * listener)` for `loadstart`, `loadprogress`, `loadend` (`ok`, `error`, `errorCode`, a Chromium net error), `urlchange`,
 * `titlechange`, `faviconchange`, `historychange`, `navigationrequest` (answer it with
 * `answerNavigation`), `newwindow`, `focuschange`, `console` (`level`, `message`),
 * `unsupported` (`command`), `crashed` and `closed`.
 */
export class WebView {
  #listeners = new Map();
  #closed = false;

  constructor(node, options) {
    this.id = ++nextWebView;
    this.node = node;
    this.url = options.url ?? "";
    this.title = "";
    this.favicon = "";
    this.loading = false;
    this.progress = 0;
    this.canGoBack = false;
    this.canGoForward = false;
    this.focused = false;
    webViews.set(this.id, this);
    const flags = (options.inspectable === false ? 0 : 1) | (options.askBeforeNavigating ? 2 : 0) | (options.transparent ? 4 : 0);
    /** Resolves to whether the view opened: there are web views only in a desktop window. */
    this.opened = shellCall(40, [this.id, node.nodeId, this.url, options.profile ?? "", flags]).then((value) => {
      if (value !== 1) webViews.delete(this.id);
      return value === 1;
    });
  }

  addEventListener(type, listener) {
    let list = this.#listeners.get(type);
    if (!list) this.#listeners.set(type, (list = new Set()));
    list.add(listener);
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  _fire(type, fields = {}) {
    const event = new WebViewEvent(type, fields);
    const handler = this["on" + type];
    if (typeof handler === "function") handler.call(this, event);
    for (const listener of this.#listeners.get(type) ?? []) listener.call(this, event);
  }

  #command(name, ...fields) {
    if (this.#closed) return;
    shellCall(42, [this.id, name, ...fields]);
  }

  #ask(name, ...fields) {
    if (this.#closed) return Promise.reject(new Error("the web view is closed"));
    return new Promise((resolve, reject) => {
      const request = webRequest(resolve, reject);
      this.#command(name, request, ...fields);
    });
  }

  navigate(url) { this.url = String(url); this.#command("navigate", this.url); }
  /** Shows `html` as if loaded from `baseUrl`. */
  loadHtml(html, baseUrl = "") { this.#command("loadHtml", baseUrl, html); }
  back() { this.#command("back"); }
  forward() { this.#command("forward"); }
  reload() { this.#command("reload"); }
  /** Reloads bypassing the cache. */
  hardReload() { this.#command("hardReload"); }
  stop() { this.#command("stop"); }
  /** Page zoom, 1 for 100%. */
  setZoom(factor) { this.#command("zoom", thousandths(factor)); }
  /** Gives the page keyboard focus. */
  focus() { this.#command("focus"); }
  /** Opens the engine's developer tools (Web Inspector on macOS). */
  openDevTools() { this.#command("devtools"); }
  setAudioMuted(muted) { this.#command("mute", muted ? 1 : 0); }
  /** The color scheme the page sees: `"system"`, `"light"` or `"dark"`. */
  setColorScheme(scheme) { this.#command("scheme", scheme === "light" || scheme === "dark" ? scheme : "system"); }
  /** Shows or hides the view; a hidden view keeps its page. */
  setShown(shown) { if (!this.#closed) shellCall(44, [this.id, shown ? 1 : 0]); }

  /** Runs `script` in the page; resolves to its value (a promise is awaited), JSON-cloned. */
  evaluate(script) {
    return this.#ask("evaluate", String(script)).then((json) => (json === "" ? undefined : JSON.parse(json)));
  }

  /** A text outline of what the page shows, with refs (`[ref=e12]`) on what an agent can act on. */
  snapshot() { return this.#ask("snapshot"); }

  /** The page's pixels: `{ width, height, data }`, RGBA rows top first, in device pixels. */
  screenshot() { return this.#ask("screenshot"); }

  /** Scrolls element `ref` (a snapshot ref) into view and clicks it with real input. */
  clickElement(ref) { return this.#ask("click", String(ref)); }

  /** Focuses element `ref`, selects its value and types `text` over it with real input. */
  fillElement(ref, text) { return this.#ask("fill", String(ref), String(text)); }

  /** A click at a point of the page's viewport, in CSS pixels. */
  clickAt(x, y, { button = 0, clickCount = 1, modifiers = 0 } = {}) {
    this.#command("clickAt", thousandths(x), thousandths(y), button, clickCount, modifiers);
  }

  movePointer(x, y, { modifiers = 0 } = {}) { this.#command("move", thousandths(x), thousandths(y), modifiers); }

  /** A wheel turn over a point, deltas in CSS pixels. */
  scroll(x, y, deltaX, deltaY, { modifiers = 0 } = {}) {
    this.#command("scroll", thousandths(x), thousandths(y), thousandths(deltaX), thousandths(deltaY), modifiers);
  }

  /** Types `text` into whatever has focus in the page. */
  typeText(text) { this.#command("type", String(text)); }

  /** Presses one key, by its DOM `key` value (`"Enter"`, `"a"`); modifiers shift 1, control 2, alt 4, meta 8. */
  pressKey(key, modifiers = 0) { this.#command("key", modifiers, String(key)); }

  /** Answers a `navigationrequest` event. */
  answerNavigation(request, allow) { this.#command("answer", request, allow ? 1 : 0); }

  /**
   * Finds `text` in the page (case insensitive) and highlights the next match, or the previous
   * one when `forward` is false; resolves to `{ matches, activeMatchOrdinal }`.
   */
  findInPage(text, { forward = true, newSession = false } = {}) {
    return this.#ask("find", forward ? 1 : 0, newSession ? 1 : 0, String(text));
  }

  stopFindInPage() { this.#command("stopFind"); }

  /** Closes the view; its page goes. */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    shellCall(41, [this.id]);
  }
}

/**
 * Shows a web view over `node` (any node: the page covers its border box). Options: `url`,
 * `profile` (a name keeps cookies and storage between runs; empty forgets them),
 * `inspectable` (default true), `askBeforeNavigating`, `transparent`.
 */
export function createWebView(node, options = {}) {
  return new WebView(node, options);
}

/**
 * Clears what the pages of profile `profile` stored (an empty name: the views opened without
 * one): `cookies` (cookies and site storage) and `cache`.
 */
export function clearWebViewData({ profile = "", cookies = true, cache = true } = {}) {
  return new Promise((resolve) => {
    const request = ++nextWebRequest;
    dataClears.set(request, resolve);
    shellCall(43, [request, cookies ? 1 : 0, cache ? 1 : 0, profile]);
  });
}

function webViewEvent(id, code, text) {
  const parts = text === "" ? [] : text.split("\x1f");
  // The last field of each event may hold the separator itself.
  const rest = (from) => parts.slice(from).join("\x1f");
  if (code === 21) {
    const request = Number(parts[0]);
    const resolve = dataClears.get(request);
    dataClears.delete(request);
    resolve?.();
    return;
  }
  const view = webViews.get(id);
  if (!view) return;
  switch (code) {
    case 1: view._fire("created"); break;
    case 2:
      webViews.delete(id);
      view._fire("closed");
      break;
    case 3:
      view.loading = true;
      view._fire("loadstart", { url: rest(0) });
      break;
    case 4:
      view.progress = Number(parts[0]) / 1000;
      view._fire("loadprogress", { progress: view.progress });
      break;
    case 5:
      view.loading = false;
      view._fire("loadend", { ok: parts[0] === "1", errorCode: -Number(parts[1] ?? 0), url: parts[2] ?? "", error: rest(3) });
      break;
    case 6:
      view.url = rest(0);
      view._fire("urlchange", { url: view.url });
      break;
    case 7:
      view.title = rest(0);
      view._fire("titlechange", { title: view.title });
      break;
    case 8:
      view.canGoBack = parts[0] === "1";
      view.canGoForward = parts[1] === "1";
      view._fire("historychange", { canGoBack: view.canGoBack, canGoForward: view.canGoForward });
      break;
    case 9:
      view._fire("navigationrequest", { request: Number(parts[0]), userInitiated: parts[1] === "1", url: rest(2) });
      break;
    case 10: view._fire("newwindow", { url: rest(0) }); break;
    case 11:
      view.focused = parts[0] === "1";
      view._fire("focuschange", { focused: view.focused });
      break;
    case 12: settleWebRequest(Number(parts[0]), parts[1] === "1", rest(2), rest(2)); break;
    case 13: settleWebRequest(Number(parts[0]), true, rest(1)); break;
    case 14:
      settleWebRequest(Number(parts[0]), true, {
        width: Number(parts[1]),
        height: Number(parts[2]),
        data: decodeBase64(parts[3] ?? ""),
      });
      break;
    case 15: settleWebRequest(Number(parts[0]), parts[1] === "1", undefined, rest(2) || "the action failed"); break;
    case 16: view._fire("console", { level: CONSOLE_LEVELS[Number(parts[0])] ?? "log", message: rest(1) }); break;
    case 17: {
      const command = rest(1);
      if (Number(parts[0])) settleWebRequest(Number(parts[0]), false, undefined, command + " is not supported here");
      view._fire("unsupported", { command });
      break;
    }
    case 18: view._fire("crashed", { reason: rest(0) }); break;
    case 19:
      view.favicon = rest(0);
      view._fire("faviconchange", { url: view.favicon });
      break;
    case 20:
      settleWebRequest(Number(parts[0]), true, { matches: Number(parts[1]), activeMatchOrdinal: Number(parts[2]) });
      break;
  }
}

/** Stops the shortcut of `accelerator`. */
/** Ends the app with an exit code once the current turn finishes. */
export function quit(code = 0) {
  shellCall(45, [String(code)]);
}

export function unregisterShortcut(accelerator) {
  const { code, bits } = parseShortcut(accelerator);
  const id = shortcutIds.get(code + "+" + bits);
  if (id === undefined) return;
  shortcutIds.delete(code + "+" + bits);
  shortcuts.delete(id);
  shellCall(4, [id]);
}

// File dialogs waiting for `DialogClosed`, by dialog id.
const dialogs = new Map();

function extensionsOf(filters) {
  const all = [];
  for (const filter of filters ?? []) {
    for (const extension of filter.extensions ?? []) {
      if (extension === "*") return "";
      all.push(String(extension).replace(/^\./, ""));
    }
  }
  return all.join(",");
}

function dialog(op, fields) {
  return shellCall(op, fields).then((id) => (id ? new Promise((resolve) => dialogs.set(id, resolve)) : []));
}

/**
 * Opens the system's file dialog, as Electron's `dialog.showOpenDialog`: `properties` takes
 * `openFile`, `openDirectory` and `multiSelections`; `filters` are `{ name, extensions }`
 * without dots (`"*"` for every file). It attaches to the window as a sheet on macOS and never
 * blocks. Resolves to `{ canceled, filePaths }`.
 */
export function showOpenDialog(options = {}) {
  const properties = options.properties ?? ["openFile"];
  const directories = properties.includes("openDirectory");
  const files = properties.includes("openFile") || !directories;
  const flags = (files ? 1 : 0) | (directories ? 2 : 0) | (properties.includes("multiSelections") ? 4 : 0);
  return dialog(5, [String(options.title ?? ""), String(options.defaultPath ?? ""), flags, extensionsOf(options.filters)]).then(
    (filePaths) => ({ canceled: filePaths.length === 0, filePaths }),
  );
}

/**
 * Opens the system's save dialog, as Electron's `dialog.showSaveDialog`. `defaultPath` may
 * name a folder, a file, or both. Resolves to `{ canceled, filePath }`.
 */
export function showSaveDialog(options = {}) {
  const path = String(options.defaultPath ?? "");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const looksLikeFolder = slash === path.length - 1 || !/\.[^./\\]+$/.test(path.slice(slash + 1));
  const directory = looksLikeFolder ? path : path.slice(0, Math.max(slash, 0));
  const name = looksLikeFolder ? "" : path.slice(slash + 1);
  return dialog(6, [String(options.title ?? ""), directory, name, extensionsOf(options.filters)]).then((paths) => ({
    canceled: paths.length === 0,
    filePath: paths[0] ?? "",
  }));
}

/**
 * Replaces the app's menu bar, as Electron's `Menu.setApplicationMenu(Menu.buildFromTemplate(t))`.
 * Items are `{ label, click, accelerator, enabled, checked, type, role, submenu, visible }`.
 * `accelerator` is `"Mod+Shift+K"` (`Mod`, `CmdOrCtrl`: Command on macOS, Control elsewhere).
 * The system roles (`about`, `quit`, `undo`, `copy`, `togglefullscreen`, `minimize`, `front`
 * and so on) are the system's own items; `zoomIn`, `zoomOut` and `resetZoom` zoom the page;
 * `appMenu`, `fileMenu`, `editMenu`, `viewMenu` and `windowMenu` are whole menus. On macOS
 * the first menu is the app menu. Edit shortcuts reach the focused node as keys first.
 */
export function setApplicationMenu(template) {
  dropMenu("app");
  const lines = [];
  packMenu(template ?? [], lines, "app");
  return shellCall(7, [lines.join("\n")]).then(() => undefined);
}

let contextMenuClosed = null;

function closeContextMenu() {
  dropMenu("context");
  const closed = contextMenuClosed;
  contextMenuClosed = null;
  closed?.();
}

/**
 * Opens a native context menu at `x`, `y` (CSS pixels in the window, a `MouseEvent`'s
 * `clientX`/`clientY`), as Electron's `menu.popup()`. Items are as `setApplicationMenu`'s.
 * Resolves when the menu closes, with or without a choice, to `true`; or at once to `false`
 * when the system draws no context menus (Linux, the browser) and the app should draw its own.
 */
export function showContextMenu(template, { x = 0, y = 0 } = {}) {
  closeContextMenu();
  const lines = [];
  packMenu(template ?? [], lines, "context");
  const zoom = appWindow.zoomFactor || 1;
  return shellCall(8, [x * zoom, y * zoom, lines.join("\n")]).then((shown) => {
    if (shown !== 1) {
      dropMenu("context");
      return false;
    }
    return new Promise((resolve) => (contextMenuClosed = () => resolve(true)));
  });
}

/** Puts `text` on the app's dock or taskbar icon (an unread count); `""` takes it off. */
export function setBadge(text) {
  return shellCall(9, [String(text ?? "")]).then((shown) => shown === 1);
}

/** Shows progress from 0 to 1 on the app's dock or taskbar icon; a negative number takes it off. */
export function setProgress(fraction) {
  return shellCall(10, [Number(fraction)]).then((shown) => shown === 1);
}

/** Opens `url` with the system's handler: a web page in the default browser, `mailto:` in the mail app. */
export function openExternal(url) {
  return shellCall(11, [String(url)]).then((opened) => opened === 1);
}

/** Shows the file or folder at `path` selected in Finder, Explorer or the file manager. */
export function showItemInFolder(path) {
  return shellCall(12, [String(path)]).then((shown) => shown === 1);
}

/**
 * Drags the files at `paths` out of the window, as Electron's `webContents.startDrag`, so
 * Finder, a mail draft or a terminal can take them. Call it from a `pointerdown` or
 * `pointermove` listener while the button is down. Resolves to whether the drag started
 * (macOS and Windows drag files out; Linux and the browser do not).
 */
export function startFileDrag(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).map(String).filter(Boolean);
  return shellCall(13, [list.join("\n")]).then((started) => started === 1);
}

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

function zoomStep(direction) {
  const now = appWindow.zoomFactor;
  if (direction > 0) return ZOOM_STEPS.find((step) => step > now + 0.001) ?? now;
  return ZOOM_STEPS.findLast((step) => step < now - 0.001) ?? now;
}

/**
 * The window the app runs in. `fullScreen` and `zoomFactor` (the page zoom, as Electron's
 * `webFrame.getZoomFactor()`; Mod with `=`, `-` and `0` change it too) are current, and
 * `fullscreenchange` and `zoomchange` say when they change. The title bar is the app's
 * configuration: a transparent one, with the window controls placed in it, comes from
 * `TitleBar.transparent` in its `tasks.silk`.
 */
class AppWindow {
  fullScreen = false;
  zoomFactor = 1;
  #listeners = new Map();

  setFullScreen(on) {
    if (!!on !== this.fullScreen) shellCall(14, [0]);
  }

  toggleFullScreen() {
    shellCall(14, [0]);
  }

  minimize() {
    shellCall(14, [1]);
  }

  /** Shows the window and brings it to the front with keyboard focus. */
  focus() {
    shellCall(14, [2]);
  }

  show() {
    shellCall(14, [2]);
  }

  hide() {
    shellCall(14, [3]);
  }

  setTitle(title) {
    shellCall(14, [4, String(title)]);
  }

  /** Zooms the page, from 0.25 to 5. Resolves to the zoom now. */
  setZoomFactor(zoom) {
    return shellCall(15, [Math.min(5, Math.max(0.25, Number(zoom) || 1))]).then((now) => {
      if (now !== this.zoomFactor) {
        this.zoomFactor = now;
        this._fire("zoomchange", { zoomFactor: now });
      }
      return now;
    });
  }

  getZoomFactor() {
    return this.zoomFactor;
  }

  isFullScreen() {
    return this.fullScreen;
  }

  addEventListener(type, listener) {
    let list = this.#listeners.get(type);
    if (!list) this.#listeners.set(type, (list = []));
    if (!list.includes(listener)) list.push(listener);
  }

  removeEventListener(type, listener) {
    const list = this.#listeners.get(type);
    const index = list ? list.indexOf(listener) : -1;
    if (index >= 0) list.splice(index, 1);
  }

  _fire(type, detail) {
    const event = { type, target: this, ...detail };
    for (const listener of (this.#listeners.get(type) ?? []).slice()) {
      try {
        listener.call(this, event);
      } catch (error) {
        reportError(error);
      }
    }
  }
}

export const appWindow = new AppWindow();

/**
 * The app's memory in bytes, as the system shows it to users: `phys_footprint` on macOS
 * (Activity Monitor's "Memory"), `Pss` on Linux and `PrivateUsage` on Windows. `processes` is
 * how many processes `footprint` counts: the host is one. In the browser it is the wasm
 * tree's linear memory, without the page's JavaScript heap. `null` when there is no answer.
 */
export function memoryUsage() {
  const footprint = native.memoryUsage?.() ?? 0;
  return footprint > 0 ? { footprint, processes: 1 } : null;
}

// Selector queries run in the host on its tree (`__ui.query`); a host without one (the web
// canvas build) answers undefined, which reads as no match.
function queried(mode, node, selector) {
  const answer = native.query?.(mode, node.nodeId, String(selector));
  if (answer === -1) {
    const message = "'" + selector + "' is not a valid selector";
    throw typeof DOMException === "function" ? new DOMException(message, "SyntaxError") : new SyntaxError(message);
  }
  return answer;
}

// `getComputedStyle`: one native read per property, made when the property is read, so a
// declaration stays live and costs nothing for the properties nobody asks for.
const readComputed = native.computed ?? (() => undefined);
const computedId = Symbol("node");
// Property names by the name they were asked by, null for the declaration's own members.
const computedNames = new Map();
const lowerNames = new Map();
function computedName(key, target) {
  let name = computedNames.get(key);
  if (name === undefined) {
    name = key in target ? null : key === "cssFloat" ? "float"
      : key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/^(webkit|moz|ms)-/, "-$1-");
    computedNames.set(key, name);
  }
  return name;
}

class CSSStyleDeclaration {
  constructor(id) { Object.defineProperty(this, computedId, { value: id }); }
  getPropertyValue(name) {
    let lower = lowerNames.get(name);
    if (lower === undefined) {
      lower = String(name).toLowerCase();
      if (typeof name === "string") lowerNames.set(name, lower);
    }
    return readComputed(this[computedId], lower) ?? "";
  }
  getPropertyPriority() { return ""; }
  setProperty() { throw new TypeError("a computed style cannot be changed"); }
  removeProperty() { throw new TypeError("a computed style cannot be changed"); }
  get cssText() { return ""; }
  get length() { return 0; }
  item() { return ""; }
}

const computedTraps = {
  get(target, key, receiver) {
    if (typeof key === "string") {
      const name = computedName(key, target);
      if (name !== null) return readComputed(target[computedId], name) ?? "";
    }
    return Reflect.get(target, key, receiver);
  },
  set() { throw new TypeError("a computed style cannot be changed"); },
};

/**
 * The values the tree resolved for `node` (an @silkui/core node, or an element of a DOM layer
 * over one): typed and animated properties as they are now, box sizes, margins, padding and
 * border widths as laid out, the rest as cascaded with lengths in pixels. Each property read
 * is one call into the tree; it applies pending changes and lays out only when something
 * changed since the last layout. Shorthands, custom properties and pseudo-elements read "".
 */
export function getComputedStyle(node, pseudo) {
  const id = node?.nodeId ?? node?.node?.nodeId;
  if (typeof id !== "number") throw new TypeError("getComputedStyle takes a node");
  return new Proxy(new CSSStyleDeclaration(pseudo ? 0 : id), computedTraps);
}

globalThis.getComputedStyle ??= getComputedStyle;

// Layout reads. Each lays out first when something changed since the last frame (as a
// browser forces layout), leaves its numbers in the bridge and answers how many there are.
const geometry = native.geometry ?? (() => 0);
const ALIGNMENTS = { start: 0, center: 1, end: 2, nearest: 3 };
const BEHAVIORS = { auto: 0, instant: 1, smooth: 2 };

function alignment(value, fallback) {
  if (value === undefined) return fallback;
  const code = ALIGNMENTS[value];
  if (code === undefined) throw new TypeError("'" + value + "' is not a valid ScrollLogicalPosition");
  return code;
}

/** A read-only rectangle, as `DOMRect` on the web. */
export class DOMRect {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
  get left() { return Math.min(this.x, this.x + this.width); }
  get top() { return Math.min(this.y, this.y + this.height); }
  get right() { return Math.max(this.x, this.x + this.width); }
  get bottom() { return Math.max(this.y, this.y + this.height); }
  toJSON() {
    const { x, y, width, height, top, right, bottom, left } = this;
    return { x, y, width, height, top, right, bottom, left };
  }
}

globalThis.DOMRect ??= DOMRect;

function metric(id, index) {
  if (!native.metrics?.(id)) return 0;
  return geometry(index);
}

function readRect(id) {
  if (!native.rect?.(id)) return new DOMRect();
  return new DOMRect(geometry(0), geometry(1), geometry(2), geometry(3));
}

function readRects(count) {
  const list = [];
  for (let i = 0; i < count; i++) list.push(new DOMRect(geometry(4 * i), geometry(4 * i + 1), geometry(4 * i + 2), geometry(4 * i + 3)));
  list.item = (index) => list[index] ?? null;
  return list;
}

// `scrollTo`, `scroll` and `scrollBy`: numbers, or `{ left, top, behavior }`. `by` is 4 for scrollBy.
function scrollNode(id, x, y, by) {
  let left, top, behavior = 0;
  if (x !== null && typeof x === "object") {
    left = x.left;
    top = x.top;
    if (x.behavior !== undefined) {
      behavior = BEHAVIORS[x.behavior];
      if (behavior === undefined) throw new TypeError("'" + x.behavior + "' is not a valid ScrollBehavior");
    }
  } else {
    left = x;
    top = y;
  }
  // As on the web, a non-finite coordinate counts as 0.
  const has = (left !== undefined ? 1 : 0) | (top !== undefined ? 2 : 0);
  const number = (value) => (Number.isFinite(+value) ? +value : 0);
  if (native.scroll) native.scroll(id, number(left), number(top), behavior, has | by);
  else if (!by) native.scrollTo(id, number(left), number(top));
}

// IntersectionObserver and ResizeObserver: the tree computes every observation after each
// layout and calls `__ui.observed(count)` with only the entries that changed.
const observersById = new Map();
let nextObserverId = 0;

function lengths(text, name) {
  const parts = String(text ?? "0px").trim().split(/\s+/);
  if (parts.length > 4) throw new SyntaxError("'" + text + "' is not a valid " + name);
  const values = [], percent = [];
  for (const part of parts) {
    const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|%)?$/.exec(part);
    if (!match || (match[2] === undefined && +match[1] !== 0)) throw new SyntaxError("'" + text + "' is not a valid " + name + ": use px or %");
    values.push(+match[1]);
    percent.push(match[2] === "%");
  }
  // top, right, bottom, left as in the margin shorthand.
  const pick = [[0, 0, 0, 0], [0, 1, 0, 1], [0, 1, 2, 1], [0, 1, 2, 3]][values.length - 1];
  const out = pick.map((i) => values[i]);
  let bits = 0;
  pick.forEach((i, side) => { if (percent[i]) bits |= 1 << side; });
  out.text = pick.map((i) => values[i] + (percent[i] ? "%" : "px")).join(" ");
  return { values: out, bits };
}

/** As `IntersectionObserverEntry` on the web. */
export class IntersectionObserverEntry {
  constructor(init) { Object.assign(this, init); }
}

/** As `IntersectionObserver` on the web, with `scrollMargin` from version 2. `root` is a node or null for the window. */
export class IntersectionObserver {
  #id = ++nextObserverId;
  #callback;
  #targets = new Map();
  #records = [];
  #margin;
  #scroll;

  constructor(callback, options = {}) {
    if (typeof callback !== "function") throw new TypeError("IntersectionObserver takes a callback");
    this.#callback = callback;
    const root = options.root ?? null;
    if (root !== null && typeof root.nodeId !== "number" && typeof root.node?.nodeId !== "number") throw new TypeError("root must be a node or null");
    this.root = root;
    this.#margin = lengths(options.rootMargin, "rootMargin");
    this.#scroll = lengths(options.scrollMargin, "scrollMargin");
    let list = options.threshold ?? 0;
    list = (Array.isArray(list) ? list : [list]).map(Number);
    for (const value of list) if (!(value >= 0 && value <= 1)) throw new RangeError("Threshold values must be numbers between 0 and 1");
    list.sort((a, b) => a - b);
    if (list.length === 0) list.push(0);
    Object.defineProperties(this, {
      rootMargin: { value: this.#margin.values.text, enumerable: true },
      scrollMargin: { value: this.#scroll.values.text, enumerable: true },
      thresholds: { value: Object.freeze(list), enumerable: true },
      delay: { value: 0, enumerable: true },
      trackVisibility: { value: false, enumerable: true },
    });
  }

  observe(target) {
    const id = target?.nodeId ?? target?.node?.nodeId;
    if (typeof id !== "number") throw new TypeError("observe takes a node");
    if (this.#targets.has(id)) return;
    if (this.#targets.size === 0) {
      const m = this.#margin.values, s = this.#scroll.values;
      const rootId = this.root ? (this.root.nodeId ?? this.root.node.nodeId) : 0;
      native.observer?.(this.#id, rootId, m[0], m[1], m[2], m[3], this.#margin.bits | (this.#scroll.bits << 4), s[0], s[1], s[2], s[3]);
      for (const value of this.thresholds) native.threshold?.(this.#id, value);
      observersById.set(this.#id, this);
    }
    this.#targets.set(id, target);
    native.observe?.(this.#id, id, 0);
  }

  unobserve(target) {
    const id = target?.nodeId ?? target?.node?.nodeId;
    if (!this.#targets.delete(id)) return;
    native.unobserve?.(this.#id, id);
    if (this.#targets.size === 0) observersById.delete(this.#id);
  }

  disconnect() {
    if (this.#targets.size === 0) return;
    this.#targets.clear();
    native.unobserve?.(this.#id, 0);
    observersById.delete(this.#id);
  }

  takeRecords() {
    const records = this.#records;
    this.#records = [];
    return records;
  }

  // The object `observe` was given: a Foldkit element is its entries' target, not its node.
  _target(id) { return this.#targets.get(id) ?? null; }

  _queue(entry) { this.#records.push(entry); }

  _deliver() {
    const records = this.takeRecords();
    if (records.length === 0) return;
    try { this.#callback.call(this, records, this); } catch (error) { reportError(error); }
  }
}

/** As `ResizeObserverEntry` on the web. */
export class ResizeObserverEntry {
  constructor(init) { Object.assign(this, init); }
}

const BOXES = { "content-box": 1, "border-box": 2, "device-pixel-content-box": 3 };

/** As `ResizeObserver` on the web: entries come after a layout that changed the observed box. */
export class ResizeObserver {
  #id = ++nextObserverId;
  #callback;
  #targets = new Map();
  #records = [];

  constructor(callback) {
    if (typeof callback !== "function") throw new TypeError("ResizeObserver takes a callback");
    this.#callback = callback;
  }

  observe(target, options) {
    const id = target?.nodeId ?? target?.node?.nodeId;
    if (typeof id !== "number") throw new TypeError("observe takes a node");
    const box = BOXES[options?.box ?? "content-box"];
    if (box === undefined) throw new TypeError("'" + options.box + "' is not a valid ResizeObserverBoxOptions");
    this.#targets.set(id, target);
    observersById.set(this.#id, this);
    native.observe?.(this.#id, id, box);
  }

  unobserve(target) {
    const id = target?.nodeId ?? target?.node?.nodeId;
    if (!this.#targets.delete(id)) return;
    native.unobserve?.(this.#id, id);
    if (this.#targets.size === 0) observersById.delete(this.#id);
  }

  disconnect() {
    if (this.#targets.size === 0) return;
    this.#targets.clear();
    native.unobserve?.(this.#id, 0);
    observersById.delete(this.#id);
  }

  // The object `observe` was given: a Foldkit element is its entries' target, not its node.
  _target(id) { return this.#targets.get(id) ?? null; }

  _queue(entry) { this.#records.push(entry); }

  _deliver() {
    const records = this.#records;
    this.#records = [];
    if (records.length === 0) return;
    try { this.#callback.call(this, records, this); } catch (error) { reportError(error); }
  }
}

const size = (inlineSize, blockSize) => Object.freeze([Object.freeze({ inlineSize, blockSize })]);

native.observed = function (count) {
  // Read every entry first: a callback's own layout reads reuse the numbers.
  const time = performance.now();
  const touched = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    const kind = geometry(at);
    const observer = observersById.get(geometry(at + 1));
    const target = observer?._target(geometry(at + 2)) ?? null;
    const read = (i) => geometry(at + i);
    if (kind === 1) {
      if (observer && target) {
        observer._queue(new IntersectionObserverEntry({
          time,
          target,
          isIntersecting: read(3) === 1,
          isVisible: false,
          intersectionRatio: read(4),
          boundingClientRect: new DOMRect(read(5), read(6), read(7), read(8)),
          intersectionRect: new DOMRect(read(9), read(10), read(11), read(12)),
          rootBounds: new DOMRect(read(13), read(14), read(15), read(16)),
        }));
      }
      at += 17;
    } else {
      if (observer && target) {
        observer._queue(new ResizeObserverEntry({
          target,
          contentRect: new DOMRect(read(3), read(4), read(5), read(6)),
          borderBoxSize: size(read(7), read(8)),
          contentBoxSize: size(read(9), read(10)),
          devicePixelContentBoxSize: size(read(11), read(12)),
        }));
      }
      at += 13;
    }
    if (observer && !touched.includes(observer)) touched.push(observer);
  }
  // ResizeObserver callbacks first, as browsers run them before intersection updates.
  for (const observer of touched) if (observer instanceof ResizeObserver) observer._deliver();
  for (const observer of touched) if (observer instanceof IntersectionObserver) observer._deliver();
};

globalThis.IntersectionObserver ??= IntersectionObserver;
globalThis.IntersectionObserverEntry ??= IntersectionObserverEntry;
globalThis.ResizeObserver ??= ResizeObserver;
globalThis.ResizeObserverEntry ??= ResizeObserverEntry;

/** The topmost node at window point `x`, `y`, or null. */
export function elementFromPoint(x, y) {
  return nodes.get(native.hit?.(Number(x), Number(y)) ?? 0) ?? null;
}

/** Every node at window point `x`, `y`, topmost first. */
export function elementsFromPoint(x, y) {
  const count = native.hits?.(Number(x), Number(y)) ?? 0;
  const list = [];
  for (let i = 0; i < count; i++) {
    const node = nodes.get(geometry(i));
    if (node) list.push(node);
  }
  return list;
}

/** The text position at window point `x`, `y`: `{ offsetNode, offset, getClientRect() }` (UTF-16 offset), or null. */
export function caretPositionFromPoint(x, y) {
  if (!native.caret?.(Number(x), Number(y))) return null;
  const offsetNode = nodes.get(geometry(0)) ?? null;
  const offset = geometry(1);
  const rect = new DOMRect(geometry(2), geometry(3), geometry(4), geometry(5));
  return { offsetNode, offset, getClientRect: () => rect };
}

/**
 * The rectangles of the text from (`startNode`, `startOffset`) to (`endNode`, `endOffset`),
 * offsets in UTF-16 units as in a DOM `Range`: one per line piece, as `Range.getClientRects`.
 */
export function rangeClientRects(startNode, startOffset, endNode, endOffset) {
  return readRects(native.rangeRects?.(startNode.nodeId, startOffset, endNode.nodeId, endOffset) ?? 0);
}

/** The union of `rangeClientRects`, as `Range.getBoundingClientRect`. */
export function rangeBoundingClientRect(startNode, startOffset, endNode, endOffset) {
  const rects = rangeClientRects(startNode, startOffset, endNode, endOffset);
  if (rects.length === 0) return new DOMRect();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * `CSS.supports(property, value)` and `CSS.supports(conditionText)`, answered by the same parser
 * and property catalog as the tree's `@supports`, so a check here and an `@supports` block in a
 * stylesheet always agree. Also installed as `globalThis.CSS.supports`.
 */
export function supports(conditionOrProperty, value) {
  if (!native.supports) return false;
  return arguments.length > 1 ? native.supports(String(conditionOrProperty), String(value)) : native.supports(String(conditionOrProperty));
}

/** `CSS.escape(text)`: `text` as a CSS identifier, escaped as the CSSOM spec does. */
export function cssEscape(value) {
  const text = String(value);
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const character = text[i];
    if (code === 0) result += "\uFFFD";
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f || (i === 0 && code >= 0x30 && code <= 0x39) || (i === 1 && code >= 0x30 && code <= 0x39 && text.charCodeAt(0) === 0x2d)) result += "\\" + code.toString(16) + " ";
    else if (i === 0 && text.length === 1 && code === 0x2d) result += "\\" + character;
    else if (code >= 0x80 || code === 0x2d || code === 0x5f || (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) result += character;
    else result += "\\" + character;
  }
  return result;
}

if (typeof globalThis.CSS !== "object" || globalThis.CSS === null) globalThis.CSS = {};
globalThis.CSS.supports ??= supports;
globalThis.CSS.escape ??= cssEscape;

let frameStatsSince = 0;

/**
 * The frames the window put on screen since the last call (since the app started, the first
 * time). `frames` counts presents, which `requestAnimationFrame` cannot: a callback can run
 * for a frame the GPU never drew. `dropped` counts painted frames a newer one replaced before
 * the GPU took them; `p50` to `max` are milliseconds between presents. `null` where the host
 * has no window of its own (a browser build).
 */
export function frameStats() {
  if (!native.frameStats) return null;
  const now = performance.now();
  const seconds = (now - frameStatsSince) / 1000;
  frameStatsSince = now;
  const frames = native.frameStats(0);
  return {
    frames,
    fps: seconds > 0 ? frames / seconds : 0,
    dropped: native.frameStats(1),
    p50: native.frameStats(2),
    p95: native.frameStats(3),
    p99: native.frameStats(4),
    max: native.frameStats(5),
  };
}

// MutationObserver, as in the DOM Standard, for the tree's nodes: child lists, attributes and
// text. Records are queued as the mutations happen and delivered in one microtask.

class MutationRecord {
  constructor(type, target, fields) {
    this.type = type;
    this.target = target;
    this.addedNodes = fields.addedNodes ?? [];
    this.removedNodes = fields.removedNodes ?? [];
    this.previousSibling = fields.previousSibling ?? null;
    this.nextSibling = fields.nextSibling ?? null;
    this.attributeName = fields.attributeName ?? null;
    this.attributeNamespace = null;
    this.oldValue = fields.oldValue ?? null;
  }
}

let mutationsQueued = false;

function queueRecord(type, target, fields, wants, oldValueOption, filterName) {
  for (const observer of mutationObservers) {
    let options = null;
    for (let node = target; node; node = node.parentNode) {
      const found = observer._targets.get(node);
      if (found && (node === target || found.subtree) && found[wants]) {
        if (filterName !== undefined && found.attributeFilter && !found.attributeFilter.includes(filterName)) continue;
        options = found;
        break;
      }
    }
    if (!options) continue;
    const record = new MutationRecord(type, target, fields);
    if (oldValueOption && !options[oldValueOption]) record.oldValue = null;
    observer._records.push(record);
    if (!mutationsQueued) {
      mutationsQueued = true;
      queueMicrotask(deliverMutations);
    }
  }
}

function deliverMutations() {
  mutationsQueued = false;
  for (const observer of [...mutationObservers]) {
    const records = observer.takeRecords();
    if (records.length === 0) continue;
    try {
      observer._callback.call(observer, records, observer);
    } catch (error) {
      reportError(error);
    }
  }
}

function childListRecord(parent, added, removed, previousSibling, nextSibling) {
  queueRecord("childList", parent, {
    addedNodes: added ? [added] : [],
    removedNodes: removed ? [removed] : [],
    previousSibling: previousSibling ?? null,
    nextSibling: nextSibling ?? null,
  }, "childList");
}

function attributeRecord(node, name, text) {
  const old = node.getAttribute(name);
  if (old === text) return;
  queueRecord("attributes", node, { attributeName: name, oldValue: old }, "attributes", "attributeOldValue", name);
}

function characterDataRecord(node, old) {
  queueRecord("characterData", node, { oldValue: old }, "characterData", "characterDataOldValue");
}

export class MutationObserver {
  constructor(callback) {
    if (typeof callback !== "function") throw new TypeError("MutationObserver needs a function");
    this._callback = callback;
    this._targets = new Map();
    this._records = [];
  }

  observe(target, options = {}) {
    if (!(target instanceof Node)) return;
    const attributes = options.attributes ?? (options.attributeOldValue !== undefined || options.attributeFilter !== undefined);
    const characterData = options.characterData ?? options.characterDataOldValue !== undefined;
    if (!options.childList && !attributes && !characterData) {
      throw new TypeError("MutationObserver.observe needs childList, attributes or characterData");
    }
    this._targets.set(target, {
      childList: !!options.childList,
      attributes: !!attributes,
      characterData: !!characterData,
      subtree: !!options.subtree,
      attributeOldValue: !!options.attributeOldValue,
      characterDataOldValue: !!options.characterDataOldValue,
      attributeFilter: options.attributeFilter ? Array.from(options.attributeFilter, String) : null,
    });
    mutationObservers.add(this);
  }

  disconnect() {
    this._targets.clear();
    this._records = [];
    mutationObservers.delete(this);
  }

  takeRecords() {
    const records = this._records;
    this._records = [];
    return records;
  }
}
