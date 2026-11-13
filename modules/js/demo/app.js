// The starter page in plain JavaScript, in a native window. Run from the repository root:
//   silk run --manifest-path modules/js/demo/silk.toml
// examples/react-counter is the same page in React.
import { createBox, createInput, createText, mount } from "@silk/ui";

const docs = "https://silk-ui-docs.juliaortiz-js.workers.dev";
const accent = "linear-gradient(135deg, rgb(139, 92, 246), rgb(6, 182, 212))";
const violet = "rgb(139, 92, 246)";

const themes = {
  dark: {
    page: "rgb(9, 9, 11)",
    glow: "linear-gradient(180deg, rgba(124, 58, 237, 0.20), rgba(9, 9, 11, 0))",
    text: "rgb(250, 250, 250)",
    muted: "rgb(161, 161, 170)",
    faint: "rgb(113, 113, 122)",
    surface: "rgba(255, 255, 255, 0.03)",
    surfaceHover: "rgba(255, 255, 255, 0.07)",
    border: "rgba(255, 255, 255, 0.10)",
    borderHover: "rgba(255, 255, 255, 0.22)",
    code: "rgba(255, 255, 255, 0.08)",
    field: "rgba(255, 255, 255, 0.05)",
    shadow: "0px 0px 48px 0px rgba(139, 92, 246, 0.45)",
  },
  light: {
    page: "rgb(250, 250, 250)",
    glow: "linear-gradient(180deg, rgba(124, 58, 237, 0.10), rgba(250, 250, 250, 0))",
    text: "rgb(9, 9, 11)",
    muted: "rgb(82, 82, 91)",
    faint: "rgb(113, 113, 122)",
    surface: "rgba(255, 255, 255, 0.9)",
    surfaceHover: "rgb(255, 255, 255)",
    border: "rgba(0, 0, 0, 0.08)",
    borderHover: "rgba(0, 0, 0, 0.20)",
    code: "rgba(0, 0, 0, 0.06)",
    field: "rgb(255, 255, 255)",
    shadow: "0px 12px 40px 0px rgba(124, 58, 237, 0.30)",
  },
};

// A box with a style and children. `paint(theme)` gives the properties that follow the theme.
const painted = [];
function box(style, children = [], paint) {
  const node = createBox(style, ...children.map((child) => (typeof child === "string" ? createText(child) : child)));
  if (paint) painted.push([node, paint]);
  return node;
}

const row = { display: "flex", flexDirection: "row", alignItems: "center" };
const column = { display: "flex", flexDirection: "column" };
const pill = { ...row, gap: 8, padding: "8px 14px", borderRadius: 999, borderWidth: 1, borderStyle: "solid", fontSize: 13 };

// Header: where to start, and the theme switch.
const hint = box(pill, [
  "Get started by editing",
  box({ padding: "2px 8px", borderRadius: 6, fontFamily: "monospace" }, ["demo/app.js"], (t) => ({ backgroundColor: t.code, color: t.text })),
], (t) => ({ borderColor: t.border, backgroundColor: t.surface, color: t.muted }));

const swatch = box({ width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderStyle: "solid" });
const switchLabel = createText("");
const themeSwitch = box(pill, [swatch, switchLabel], (t) => ({ borderColor: t.border, backgroundColor: t.surface, color: t.muted }));
themeSwitch.tabIndex = 0;
themeSwitch.setAttribute("cursor", "pointer");
themeSwitch.setAttribute("testId", "theme");
themeSwitch.addEventListener("click", () => apply(current === themes.dark ? themes.light : themes.dark));

// The logo: three threads on a gradient tile.
const logo = box({ position: "relative", width: 84, height: 84, borderRadius: 24, backgroundImage: accent }, [
  [40, 14], [30, 26], [40, 18],
].map(([width, left], i) => box({
  position: "absolute", left, top: 24 + i * 14, width, height: 8, borderRadius: 4,
  backgroundColor: i === 1 ? "rgba(255, 255, 255, 0.65)" : "rgb(255, 255, 255)",
})), (t) => ({ boxShadow: t.shadow }));
logo.setAttribute("label", "Silk UI");

// The counter, a name field and how long the window has been open.
const label = createText("Click me");
const button = box({
  ...row, justifyContent: "center", minWidth: 180, padding: "12px 22px", borderRadius: 999,
  fontSize: 15, fontWeight: 700, color: "white", backgroundImage: accent,
}, [label]);
button.look("hover").set({ backgroundImage: "linear-gradient(135deg, rgb(157, 116, 255), rgb(34, 211, 238))" });
button.look("active").set({ backgroundImage: "linear-gradient(135deg, rgb(109, 40, 217), rgb(8, 145, 178))" });
button.tabIndex = 0;
button.setAttribute("cursor", "pointer");
button.setAttribute("testId", "counter");
let clicks = 0;
button.addEventListener("click", () => {
  clicks++;
  label.data = clicks === 1 ? "Clicked" : "Clicked " + clicks + " times";
});

const name = createInput({ width: 200, padding: "11px 16px", borderRadius: 999, borderWidth: 1, borderStyle: "solid", fontSize: 15 });
name.setAttribute("placeholder", "Your name");
name.setAttribute("testId", "name");
name.look("focus").set({ borderColor: violet });
painted.push([name, (t) => ({ borderColor: t.border, backgroundColor: t.field, color: t.text })]);

const status = createText("");
let greeting = "";
const started = performance.now();
function showStatus() {
  status.data = greeting + "Open for " + Math.round((performance.now() - started) / 1000) + " s";
}
name.addEventListener("input", (event) => {
  greeting = event.value ? "Hello " + event.value + ". " : "";
  showStatus();
});
setInterval(showStatus, 1000);
showStatus();

const hero = box({ ...column, alignItems: "center", justifyContent: "center", gap: 22, flexGrow: 1 }, [
  logo,
  box({ ...column, alignItems: "center", gap: 10 }, [
    box({ fontSize: 56, fontWeight: 700, lineHeight: 1.1 }, ["Silk UI"]),
    box({ fontSize: 18, textAlign: "center", maxWidth: 520 }, [
      "Native apps in JavaScript and React. No browser inside, just a fast UI tree on the GPU.",
    ], (t) => ({ color: t.muted })),
  ]),
  box({ ...column, alignItems: "center", gap: 14, marginTop: 6 }, [
    box({ ...row, gap: 12 }, [button, name]),
    box({ fontSize: 13 }, [status], (t) => ({ color: t.faint })),
  ]),
]);

// Cards that open the documentation.
const links = [
  ["Docs", "/", "Find out how Silk UI works, from the tree to whole apps."],
  ["Tutorial", "/core/tutorial/", "Build a complete app in five short steps."],
  ["Native apps", "/native/", "Windows, input and the GPU, without a browser."],
  ["UI tree", "/tree/", "The retained tree this page is drawn with."],
];
const cards = box({ ...row, alignItems: "stretch", flexWrap: "wrap", gap: 16 }, links.map(([title, path, text]) => {
  const card = box({
    ...column, gap: 8, flexGrow: 1, flexBasis: 0, minWidth: 180, padding: "18px 20px",
    borderRadius: 14, borderWidth: 1, borderStyle: "solid",
  }, [
    box({ fontSize: 17, fontWeight: 700 }, [title + " →"]),
    box({ lineHeight: 1.45 }, [text], (t) => ({ color: t.muted })),
  ], (t) => ({ borderColor: t.border, backgroundColor: t.surface }));
  card.setAttribute("href", docs + path);
  card.setAttribute("label", title);
  card.setAttribute("cursor", "pointer");
  card.tabIndex = 0;
  card.look("active").set({ borderColor: violet });
  card.look("focusVisible").set({ borderColor: violet });
  painted.push([card.look("hover"), (t) => ({ borderColor: t.borderHover, backgroundColor: t.surfaceHover })]);
  return card;
}));

const footer = box({ ...row, justifyContent: "center", padding: "14px 40px", borderTopWidth: 1, borderTopStyle: "solid", fontSize: 12 }, [
  "Plain JavaScript on the SilkJS engine, drawn by the Silk UI tree.",
], (t) => ({ borderTopColor: t.border, color: t.faint }));

const content = box({ ...column, flexGrow: 1, padding: "28px 40px", gap: 32 }, [
  box({ ...row, justifyContent: "space-between", gap: 16 }, [hint, themeSwitch]),
  hero,
  cards,
], (t) => ({ backgroundImage: t.glow }));

const page = box({ ...column, position: "absolute", inset: 0, overflowY: "auto", fontSize: 14 }, [content, footer], (t) => ({
  backgroundColor: t.page,
  color: t.text,
}));

let current = null;
function apply(theme) {
  current = theme;
  for (const [target, paint] of painted) (target.style ?? target).set(paint(theme));
  const other = theme === themes.dark ? themes.light : themes.dark;
  swatch.style.set({ backgroundColor: other.page, borderColor: theme.borderHover });
  switchLabel.data = theme === themes.dark ? "Light mode" : "Dark mode";
  themeSwitch.look("hover").set({ borderColor: theme.borderHover, color: theme.text });
}

apply(themes.dark);
mount(page);
console.log("ui-js demo started");
