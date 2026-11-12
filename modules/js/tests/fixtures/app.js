// A counter on @silk/ui: the same tree as counter.js (1 the root, 2 the field, 3 the button,
// 4 the label), built with the node API and handled with DOM style listeners.
import { createBox, createText, createInput, mount } from "@silk/ui";

const root = mount(createBox({ width: 400, height: 300 }));
const field = createInput({ width: 200, height: 30 });
const button = createBox({ width: 180, height: 70, backgroundColor: "rgb(0, 100, 200)" });
button.tabIndex = 0;
button.look("hover").set({ backgroundColor: "rgb(0, 120, 230)", opacity: 0.9 });
button.style.set({ height: 80, marginTop: 4 });
button.style.set({ height: 70, marginTop: null });
button.setAttribute("testId", "counter");
const label = createText("Click me");
button.append(label);
root.append(field, button);
field.focus();

const log = [];
let clicks = 0;
root.addEventListener("click", (event) => log.push("root capture " + event.eventPhase), true);
button.addEventListener("click", (event) => {
  log.push("button " + event.clientX + "," + event.clientY + " " + (event.currentTarget === button));
});
root.addEventListener("click", (event) => log.push("root bubble " + event.eventPhase));
button.addEventListener("click", () => {
  clicks++;
  // The label changes in a promise job: the host runs it before it applies the mutations.
  Promise.resolve().then(() => {
    label.data = "Clicked " + clicks;
  });
});
button.addEventListener("pointerdown", (event) => {
  if (globalThis.keepFocus) event.preventDefault();
});
field.addEventListener("input", (event) => {
  globalThis.typed = event.value + "|" + event.inputType + "|" + field.value;
});
field.addEventListener("keydown", (event) => {
  globalThis.lastKey = event.key;
});

globalThis.keepFocus = true;
globalThis.log = log;
globalThis.app = { root, field, button, label };
