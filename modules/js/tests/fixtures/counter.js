// A counter against the raw __ui functions, with the dispatcher an application library would
// provide: handlers per node and kind, bubbling over a parent map, preventDefault.
let next = 1;
const parents = new Map();
const handlers = new Map();
const KIND = { pointerdown: 0, pointerup: 1, click: 2 };

function box(parent, width, height) {
  const id = ++next;
  __ui.create(id, 0);
  __ui.style(id, "width:" + width + "px;height:" + height + "px", 0);
  __ui.append(parent, id);
  parents.set(id, parent);
  return id;
}

function text(parent, value) {
  const id = ++next;
  __ui.create(id, 1);
  __ui.setText(id, value);
  __ui.append(parent, id);
  parents.set(id, parent);
  return id;
}

function on(id, kind, handler) {
  let byKind = handlers.get(id);
  if (!byKind) handlers.set(id, (byKind = new Map()));
  byKind.set(KIND[kind], handler);
}

__ui.dispatch = function (kind, target, x, y) {
  const event = {
    target, x, y, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  for (let id = target; id !== undefined && !event.stopped; id = parents.get(id)) {
    const handler = handlers.get(id)?.get(kind);
    if (handler) handler(event);
  }
  return event.defaultPrevented;
};

__ui.create(1, 0);
__ui.root(1);
const field = box(1, 200, 30);
__ui.attribute(field, "tabIndex", 0);
const button = box(1, 180, 70);
__ui.attribute(button, "tabIndex", 0);
__ui.listen(button, 1 | 4);
const label = text(button, "Click me");
__ui.focus(field);

let clicks = 0;
globalThis.keepFocus = true;
globalThis.lastPoint = "";
on(button, "pointerdown", (event) => {
  globalThis.lastPoint = event.x + "," + event.y;
  if (globalThis.keepFocus) event.preventDefault();
});
on(button, "click", () => {
  clicks++;
  __ui.setText(label, "Clicked " + clicks);
});
