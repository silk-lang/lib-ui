import assert from "node:assert/strict";
import { test } from "node:test";
import { installMock } from "./mock.js";

const mock = installMock();
const { createBox, createText, createInput, mount, nodeById, setErrorHandler, parseMarkdown } = await import("../src/index.js");

test("nodes queue their mutations", () => {
  mock.take();
  const label = createText("hi");
  const box = createBox({ width: 10, opacity: 0.5, backgroundColor: "red", gridColumn: 2 }, label);
  mount(box);
  assert.deepEqual(mock.take(), [
    ["create", label.id, 1],
    ["setText", label.id, "hi"],
    ["create", box.id, 0],
    ["style", box.id, "width:10px;opacity:0.5;background-color:red;grid-column:2;", 0],
    ["append", box.id, label.id],
    ["root", box.id],
  ]);
  assert.equal(label.parentNode, box);
  assert.equal(nodeById(box.id), box);
});

test("a style sends what changed, and removal restarts the look", () => {
  const box = createBox({ width: 10, height: 20 });
  mock.take();
  box.style.set({ width: 10, height: 30 });
  assert.deepEqual(mock.take(), [["style", box.id, "height:30px;", 0]]);
  box.style.set({ width: null });
  assert.deepEqual(mock.take(), [["clearStyle", box.id, 0], ["style", box.id, "height:30px;", 0]]);
  box.look("hover").set({ color: "blue" });
  assert.deepEqual(mock.take(), [["style", box.id, "color:blue;", 1]]);
});

test("moving a child keeps one parent", () => {
  const a = createBox();
  const b = createBox();
  const child = createBox();
  a.append(child);
  b.insertBefore(child, null);
  assert.deepEqual(a.childNodes, []);
  assert.deepEqual(b.childNodes, [child]);
  assert.throws(() => child.append(b), /own subtree/);
  child.remove();
  assert.equal(child.parentNode, null);
});

test("events run capture, target and bubble phases", () => {
  const root = createBox();
  const middle = createBox();
  const leaf = createBox();
  root.append(middle);
  middle.append(leaf);
  const log = [];
  root.addEventListener("click", (event) => log.push("root capture " + event.eventPhase), true);
  middle.addEventListener("click", (event) => log.push("middle " + event.eventPhase));
  leaf.addEventListener("click", (event) => log.push("leaf " + event.eventPhase + " " + event.clientX));
  root.addEventListener("click", (event) => log.push("root " + event.eventPhase));
  assert.equal(mock.click(leaf.id, 7), false);
  assert.deepEqual(log, ["root capture 1", "leaf 2 7", "middle 3", "root 3"]);

  log.length = 0;
  middle.addEventListener("click", (event) => event.stopPropagation());
  mock.click(leaf.id);
  assert.deepEqual(log, ["root capture 1", "leaf 2 0", "middle 3"]);
});

test("listen flags follow the listeners", () => {
  const box = createBox();
  mock.take();
  const listener = () => {};
  box.addEventListener("click", listener);
  box.addEventListener("keydown", listener, { once: true });
  box.removeEventListener("click", listener);
  assert.deepEqual(mock.take(), [["listen", box.id, 4], ["listen", box.id, 4 | 128], ["listen", box.id, 128]]);
  assert.throws(() => box.addEventListener("nope", listener), /no event/);
});

test("preventDefault reaches the host for cancelable events only", () => {
  const box = createBox();
  box.addEventListener("pointerdown", (event) => event.preventDefault());
  box.addEventListener("focus", (event) => event.preventDefault());
  assert.equal(mock.native.dispatch(0, box.id, 0, 0, 0, 0, 1), true);
  assert.equal(mock.native.dispatch(9, box.id, 0, 0, 0, 0, 0), false);
});

test("an input follows what the user types", () => {
  const input = createInput();
  let seen;
  input.addEventListener("input", (event) => (seen = event.value + "/" + event.inputType));
  mock.input(input.id, "abc");
  assert.equal(seen, "abc/insertText");
  assert.equal(input.value, "abc");
});

test("a listener that throws does not stop the dispatch", () => {
  const box = createBox();
  const log = [];
  box.addEventListener("click", () => {
    throw new Error("boom");
  });
  box.addEventListener("click", () => log.push("second"));
  mock.click(box.id);
  assert.deepEqual(log, ["second"]);
  assert.throws(() => mock.native.takeError(), /boom/);
  mock.native.takeError();

  const errors = [];
  setErrorHandler((error) => errors.push(error.message));
  mock.click(box.id);
  assert.deepEqual(errors, ["boom"]);
  setErrorHandler(null);
});

test("unload destroys every node, for a reload", () => {
  const box = createBox({}, createText("bye"));
  mount(box);
  mock.take();
  mock.native.unload();
  const destroyed = mock.take().filter((call) => call[0] === "destroy").map((call) => call[1]);
  assert.ok(destroyed.includes(box.id));
  assert.equal(nodeById(box.id), null);
});

test("a font family list is defined once and named by number", () => {
  mock.take();
  const a = createBox({ fontFamily: "monospace" });
  const b = createBox({ fontFamily: "monospace" });
  const calls = mock.take();
  const defined = calls.filter((call) => call[0] === "fontFamily");
  assert.equal(defined.length, 1);
  assert.equal(defined[0][2], "monospace");
  const id = defined[0][1];
  assert.deepEqual(calls.filter((call) => call[0] === "style"), [
    ["style", a.id, "font-family:" + id + ";", 0],
    ["style", b.id, "font-family:" + id + ";", 0],
  ]);
});

test("a click inside a link opens its address unless a listener prevents it", () => {
  const opened = [];
  globalThis.open = (url) => opened.push(url);
  const link = createBox();
  const inside = createBox();
  link.append(inside);
  mock.take();
  link.setAttribute("href", "https://example.com/");
  assert.deepEqual(mock.take(), [["listen", link.id, 4], ["attribute", link.id, "href", "https://example.com/"]]);
  mock.click(inside.id);
  assert.deepEqual(opened, ["https://example.com/"]);

  const stop = (event) => event.preventDefault();
  link.addEventListener("click", stop);
  mock.click(inside.id);
  assert.equal(opened.length, 1);
  link.removeEventListener("click", stop);
  assert.deepEqual(mock.take(), [], "the link still wants clicks");

  link.setAttribute("href", "");
  assert.deepEqual(mock.take(), [["listen", link.id, 0], ["attribute", link.id, "href", ""]]);
  delete globalThis.open;
});

test("role and aria-* reach the tree under its own names", () => {
  const box = createBox();
  mock.take();
  box.setAttribute("role", "button");
  box.setAttribute("aria-label", "Save");
  box.setAttribute("ariaExpanded", true);
  box.setAttribute("aria-checked", "false");
  box.setAttribute("aria-selected", "true");
  assert.deepEqual(mock.take(), [
    ["attribute", box.id, "role", "button"],
    ["attribute", box.id, "label", "Save"],
    ["attribute", box.id, "expanded", true],
    ["attribute", box.id, "checked", false],
    ["attribute", box.id, "selected", true],
  ]);
});

test("aria-value* make one range, and it clears without a value", () => {
  const box = createBox();
  mock.take();
  box.setAttribute("aria-valuenow", "30");
  box.setAttribute("ariaValueMax", 50);
  box.setAttribute("aria-valuenow", null);
  assert.deepEqual(mock.take(), [
    ["attribute", box.id, "valueRange", 0, 100, 30],
    ["attribute", box.id, "valueRange", 0, 50, 30],
    ["attribute", box.id, "valueRange"],
  ]);
});

test("an unknown role or ARIA name warns once and throws nothing", () => {
  const box = createBox();
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    mock.take();
    box.setAttribute("role", "unknown");
    box.setAttribute("role", "unknown");
    box.setAttribute("aria-describedby", "x");
    assert.deepEqual(mock.take(), [["attribute", box.id, "role", "unknown"], ["attribute", box.id, "role", "unknown"]]);
    assert.deepEqual(warnings, ["the tree has no role 'unknown': it is ignored", "the tree has no 'aria-describedby' yet: it is ignored"]);
  } finally {
    console.warn = warn;
  }
});

test("parseMarkdown turns GFM on unless told otherwise", () => {
  mock.take();
  assert.deepEqual(parseMarkdown("# hi"), { type: "root", children: [] });
  parseMarkdown("x", { gfm: false, footnotes: true });
  parseMarkdown("x", { tables: false, alerts: true });
  assert.deepEqual(mock.take().map((call) => call[2]), [15, 16, 78]);
});
