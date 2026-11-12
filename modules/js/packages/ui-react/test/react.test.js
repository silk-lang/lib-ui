import assert from "node:assert/strict";
import { test } from "node:test";
import { installMock } from "../../ui/test/mock.js";

const mock = installMock();
const { createElement: h, useState } = await import("react");
const { createRoot, flushSync } = await import("../src/index.js");
const { createBox } = await import("@silk/ui");

function find(calls, name, predicate = () => true) {
  return calls.filter((call) => call[0] === name && predicate(call));
}

test("a component renders nodes, styles, attributes and text", () => {
  const container = createBox();
  mock.take();
  createRoot(container).render(
    h("box", { style: { width: 100 }, hoverStyle: { color: "red" }, testId: "greeting", tabIndex: 0 }, "Hello ", "world"),
  );
  const calls = mock.take();
  const box = find(calls, "create", (call) => call[2] === 0)[0][1];
  assert.deepEqual(find(calls, "style"), [["style", box, "width:100px;", 0], ["style", box, "color:red;", 1]]);
  assert.deepEqual(find(calls, "attribute"), [["attribute", box, "testId", "greeting"], ["attribute", box, "tabIndex", 0]]);
  assert.deepEqual(find(calls, "setText").map((call) => call[2]), ["Hello ", "world"]);
  assert.deepEqual(find(calls, "append").at(-1), ["append", container.id, box]);
});

test("a click updates state and commits before the dispatch returns", () => {
  let button;
  function Counter() {
    const [clicks, setClicks] = useState(0);
    return h("box", { ref: (node) => (button = node), onClick: () => setClicks(clicks + 1) }, "Clicked " + clicks);
  }
  createRoot(createBox()).render(h(Counter));
  const label = button.firstChild;
  assert.equal(label.data, "Clicked 0");
  mock.click(label.id);
  assert.equal(label.data, "Clicked 1");
  mock.click(label.id);
  assert.equal(label.data, "Clicked 2");
});

test("props that change update the node, and props that go away are reset", () => {
  const root = createRoot(createBox());
  root.render(h("box", { style: { width: 1, height: 2 }, label: "one", onClick() {} }));
  mock.take();
  root.render(h("box", { style: { width: 3 } }));
  const calls = mock.take();
  const id = calls[0][1];
  assert.deepEqual(calls, [["clearStyle", id, 0], ["style", id, "width:3px;", 0], ["attribute", id, "label", ""]]);
});

test("removed elements are destroyed", () => {
  const container = createBox();
  const root = createRoot(container);
  root.render(h("box", null, h("box", { key: "a" }), h("box", { key: "b" })));
  const [a] = container.firstChild.childNodes;
  mock.take();
  root.render(h("box", null, h("box", { key: "b" })));
  assert.deepEqual(mock.take(), [["destroy", a.id]]);
  root.unmount();
  assert.equal(container.childNodes.length, 0);
});

test("a controlled input keeps the value the component gives it", () => {
  let input;
  function Field() {
    const [value, setValue] = useState("");
    return h("input", { ref: (node) => (input = node), value, onInput: (event) => setValue(event.value.toUpperCase().slice(0, 3)) });
  }
  createRoot(createBox()).render(h(Field));
  mock.input(input.id, "ab");
  assert.equal(input.value, "AB");
  assert.equal(mock.textOf(input.id), "AB");
  mock.input(input.id, "ABcd");
  assert.equal(input.value, "ABC");
});

test("flushSync commits a state change made outside an event", () => {
  let set;
  let label;
  function App() {
    const [text, setText] = useState("a");
    set = setText;
    return h("box", { ref: (node) => (label = node?.firstChild) }, text);
  }
  createRoot(createBox()).render(h(App));
  flushSync(() => set("b"));
  assert.equal(label.data, "b");
});
