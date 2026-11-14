// What the page uses of @silk/ui, on browser elements: `createBox` and the node a ref
// gives (`style.set`, `append`, `destroy`). motion.js draws through it unchanged.

// Style keys a bare number does not get `px` on, as React DOM does it.
const UNITLESS = new Set(["opacity", "fontWeight", "lineHeight", "flexGrow", "flexShrink", "zIndex", "order"]);
const nodes = new WeakMap();

export function setStyle(style, values) {
  for (const key in values) {
    const value = values[key];
    style[key] = value == null ? "" : typeof value === "number" && !UNITLESS.has(key) ? value + "px" : value;
  }
}

/** A tree node's interface over one element. */
export class Node {
  constructor(element) {
    this.element = element;
    this.style = { set: (values) => setStyle(element.style, values) };
    nodes.set(element, this);
  }
  append(...children) {
    for (const child of children) this.element.append(child instanceof Node ? child.element : child);
  }
  destroy() {
    this.element.remove();
  }
}

/** The node for an element React made, the same one every time. */
export const nodeOf = (element) => nodes.get(element) ?? new Node(element);

export function createBox(style, ...children) {
  const node = new Node(document.createElement("div"));
  if (style) node.style.set(style);
  node.append(...children);
  return node;
}

/** `open(url)` of ui-js: the system browser, from Electron's or Tauri's shell. */
export function openUrl(url) {
  if (!/^(https?|mailto):/.test(url)) return;
  if (window.__TAURI__) window.__TAURI__.core.invoke("plugin:opener|open_url", { url });
  else window.open(url, "_blank");
}
