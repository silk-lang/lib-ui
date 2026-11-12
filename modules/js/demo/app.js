// A counter in JavaScript in a native window. Run from the repository root:
//   silk run --manifest-path modules/js/demo/silk.toml
import { createBox, createText, mount } from "@silk/ui";

const label = createText("Click me");
const button = createBox(
  {
    width: 180,
    height: 70,
    fontSize: 24,
    padding: 12,
    borderRadius: 8,
    color: "white",
    backgroundColor: "rgb(0, 100, 200)",
  },
  label,
);
button.look("hover").set({ backgroundColor: "rgb(0, 120, 230)" });
button.look("active").set({ backgroundColor: "rgb(0, 80, 170)" });
button.tabIndex = 0;
button.setAttribute("testId", "counter");

let clicks = 0;
button.addEventListener("click", () => {
  clicks++;
  label.data = clicks === 1 ? "Clicked" : "Clicked " + clicks + " times";
});

const elapsed = createText("");
const started = performance.now();
setInterval(() => {
  elapsed.data = "Open for " + Math.round((performance.now() - started) / 1000) + " s";
}, 1000);

mount(createBox({ padding: 24, gap: 16, display: "flex", flexDirection: "column" }, button, createBox({ fontSize: 14 }, elapsed)));
console.log("ui-js demo started");
