// The starter page in plain JavaScript, in a native window: the counter is the page. Click
// anywhere and the number, the dots, the rings and the sparks answer. Run from the
// repository root:
//   silk run --manifest-path modules/js/demo/silk.toml
// examples/react-counter is the same page in React.
import { createBox, createText, mount } from "@silk/ui";

const DOCS = "https://silk-ui-docs.juliaortiz-js.workers.dev";
const SANS = "Geist, Noto Sans, sans-serif";
const MONO = "Geist Mono, monospace";
const LINKS = [
  ["Docs", "/"],
  ["Tutorial", "/core/tutorial/"],
  ["Native apps", "/native/"],
  ["UI tree", "/tree/"],
];

// The two looks. `ink` is the color of the dots, the text and the number at zero; `colors`
// are what the number cycles through, one per click.
const themes = {
  dark: {
    page: "rgb(4, 4, 5)", ink: [250, 250, 250], muted: "rgb(161, 161, 170)", faint: "rgb(113, 113, 122)", track: "rgb(24, 24, 27)",
    colors: [[250, 250, 250], [163, 230, 53], [34, 211, 238], [167, 139, 250], [251, 113, 133], [251, 191, 36]],
  },
  light: {
    page: "rgb(250, 250, 250)", ink: [9, 9, 11], muted: "rgb(82, 82, 91)", faint: "rgb(113, 113, 122)", track: "rgb(228, 228, 231)",
    colors: [[9, 9, 11], [77, 124, 15], [8, 145, 178], [124, 58, 237], [225, 29, 72], [217, 119, 6]],
  },
};
let theme = themes.dark;
const rgb = (c, a = 1) => "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
const color = () => theme.colors[clicks % theme.colors.length];

// el(style, ...children): strings become text nodes.
function el(style = {}, ...children) {
  return createBox(style, ...children.map((child) => (typeof child === "string" ? createText(child) : child)));
}
const row = { display: "flex", flexDirection: "row", alignItems: "center" };
const column = { display: "flex", flexDirection: "column" };
const layer = { position: "absolute", inset: 0, pointerEvents: "none" };

let clicks = 0;
let pulse = 0; // 1 at a click, fading
let streak = 0; // fast clicks in a row
let lastClick = -10;
let now = 0;

// The dot field. Many nodes fade here, so they fade by the alpha of their color.
const GAP = 44;
const dots = [];
const field = el(layer);
for (let r = 0; r < 26; r++) {
  for (let c = 0; c < 40; c++) {
    const node = el({ position: "absolute", left: c * GAP + 20, top: r * GAP + 18, width: 2, height: 2, borderRadius: 1 });
    field.append(node);
    dots.push({ node, x: c * GAP + 21, y: r * GAP + 19, level: -1, size: 2, shimmer: 0 });
  }
}
const waves = [];

// A glow behind the number, the rings and sparks of each click, and a ring on the pointer.
const glow = el({ position: "absolute", width: 2, height: 2, borderRadius: 1 });
const pointerRing = el({ position: "absolute", width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderStyle: "solid" });
const effects = el(layer, glow, pointerRing);
const rings = [];
const sparks = [];

// The number: the main copy, two color-split ghosts, and the last number rolling away.
const SIZE = 340;
function digit(tint) {
  const text = createText("0");
  const node = el({ position: "absolute", left: 0, right: 0, top: 0, textAlign: "center", fontSize: SIZE, fontWeight: 700, lineHeight: 1, letterSpacing: -12, color: tint, opacity: tint ? 0 : 1 }, text);
  return { node, text };
}
const previous = digit("");
const ghostRed = digit("rgb(255, 40, 90)");
const ghostCyan = digit("rgb(40, 220, 255)");
const main = digit("");
previous.node.style.set({ opacity: 0 });
const number = el({ position: "relative", alignSelf: "stretch", height: SIZE, pointerEvents: "none" }, previous.node, ghostRed.node, ghostCyan.node, main.node);
let rolledAt = -10;

// Chrome: the name, where to start, the theme switch, the count in words, the links.
const brandDot = el({ width: 10, height: 10, borderRadius: 5 });
const file = el({}, "demo/app.js");
const switchLabel = createText("");
const themeSwitch = el({ padding: "3px 10px", borderRadius: 999, borderWidth: 1, borderStyle: "solid", fontFamily: MONO, fontSize: 11 }, switchLabel);
themeSwitch.tabIndex = 0;
themeSwitch.setAttribute("cursor", "pointer");
themeSwitch.setAttribute("testId", "theme");
themeSwitch.addEventListener("click", (event) => {
  event.stopPropagation();
  applyTheme(theme === themes.dark ? themes.light : themes.dark);
});
const startHint = el({ ...row, gap: 8, position: "absolute", right: 28, top: 0, bottom: 0, fontFamily: MONO, fontSize: 12 }, "edit", file, "to make it yours");
// The bar at the top is the window's title bar where the system lets the page draw it: the
// window controls sit at its left, and nothing in it takes clicks.
const top = el({ ...row, position: "relative", justifyContent: "center", height: 56, flexShrink: 0 },
  el({ ...row, gap: 10, fontWeight: 600, fontSize: 15 }, brandDot, "Silk UI"),
  startHint);

const words = createText("CLICK ANYWHERE");
const wordsBox = el({ fontFamily: MONO, fontSize: 12, letterSpacing: 2 }, words);
const links = LINKS.map(([title, path]) => {
  const link = el({ whiteSpace: "nowrap" }, title + " ↗");
  link.setAttribute("href", DOCS + path);
  link.setAttribute("cursor", "pointer");
  link.tabIndex = 0;
  // A click on a link opens it and does not count.
  link.addEventListener("click", (event) => event.stopPropagation());
  return link;
});
const streakBar = el({ height: 2, width: 0 });
const track = el({ height: 2 }, streakBar);
const bottom = el(column,
  el({ ...row, justifyContent: "space-between", padding: "0 28px 18px", fontSize: 13 }, wordsBox, el({ ...row, gap: 22 }, ...links, themeSwitch)),
  track);

const page = el({ position: "absolute", inset: 0, overflow: "hidden", fontFamily: SANS }, field, effects,
  el({ ...column, position: "absolute", inset: 0 }, top, el({ ...column, alignItems: "center", justifyContent: "center", flexGrow: 1, pointerEvents: "none" }, number), bottom));
page.setAttribute("testId", "counter");
page.setAttribute("cursor", "pointer");

function applyTheme(next) {
  theme = next;
  page.style.set({ backgroundColor: theme.page, color: rgb(theme.ink) });
  brandDot.style.set({ backgroundColor: rgb(theme.ink) });
  startHint.style.set({ color: theme.faint });
  file.style.set({ color: rgb(theme.ink) });
  themeSwitch.style.set({ borderColor: theme.track, color: theme.muted });
  themeSwitch.look("hover").set({ color: rgb(theme.ink), borderColor: theme.faint });
  switchLabel.data = theme === themes.dark ? "LIGHT" : "DARK";
  wordsBox.style.set({ color: theme.muted });
  for (const link of links) {
    link.style.set({ color: theme.muted });
    link.look("hover").set({ color: rgb(theme.ink) });
  }
  track.style.set({ backgroundColor: theme.track });
  previous.node.style.set({ color: rgb(theme.ink) });
  for (const dot of dots) dot.level = -1;
}

// The window's size and the pointer.
const view = { width: 1040, height: 720, x: 520, y: 360, inside: false };
page.addEventListener("layout", (event) => {
  view.width = event.bounds.width;
  view.height = event.bounds.height;
});
page.addEventListener("pointermove", (event) => {
  view.x = event.clientX;
  view.y = event.clientY;
  view.inside = true;
});

page.addEventListener("click", (event) => {
  streak = now - lastClick < 0.7 ? Math.min(12, streak + 1) : 1;
  lastClick = now;
  previous.text.data = String(clicks);
  clicks++;
  for (const copy of [main, ghostRed, ghostCyan]) copy.text.data = String(clicks);
  rolledAt = now;
  pulse = 1;
  words.data = (clicks === 1 ? "CLICKED" : "CLICKED " + clicks + " TIMES") + (streak > 2 ? "  ×" + streak : "");

  const tint = color();
  waves.push({ x: event.clientX, y: event.clientY, at: now });
  for (let i = 0; i < 3; i++) {
    const node = el({ position: "absolute", borderRadius: 9999, borderWidth: i === 0 ? 3 : 1, borderStyle: "solid", borderColor: rgb(tint, 0) });
    effects.append(node);
    rings.push({ node, x: event.clientX, y: event.clientY, age: -i * 0.1, tint });
  }
  for (let i = 0, count = 14 + streak * 3; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 260 + Math.random() * 620;
    const size = 3 + Math.random() * 7;
    const sparkTint = Math.random() < 0.3 ? theme.ink : tint;
    const node = el({ position: "absolute", width: size, height: size, borderRadius: Math.random() < 0.5 ? size / 2 : 1 });
    effects.append(node);
    sparks.push({ node, tint: sparkTint, x: event.clientX, y: event.clientY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 180, age: 0, life: 0.7 + Math.random() * 0.7 });
  }
});

const easeOut = (p) => 1 - Math.pow(1 - p, 3);
let ringX = view.x;
let ringY = view.y;

function frame(time, dt) {
  now = time;
  const tint = color();
  pulse *= Math.exp(-dt * 4.5);
  if (time - lastClick > 0.7) streak = Math.max(0, streak - dt * 6);
  streakBar.style.set({ width: Math.round(view.width * Math.min(1, streak / 12)), backgroundColor: rgb(tint) });

  // The number: it rolls in from below, pops, splits into colors, and shakes on a streak.
  const roll = easeOut(Math.min(1, (time - rolledAt) / 0.32));
  const shake = pulse * Math.min(10, streak * 1.6);
  const size = Math.round(SIZE * (1 + pulse * 0.07));
  const top = Math.round((1 - roll) * 120);
  main.node.style.set({ top: top + Math.round((Math.random() - 0.5) * shake), left: Math.round((Math.random() - 0.5) * shake), opacity: roll.toFixed(2), color: rgb(tint), fontSize: size });
  ghostRed.node.style.set({ top, left: Math.round(-pulse * 16), opacity: (pulse * 0.8).toFixed(2), fontSize: size });
  ghostCyan.node.style.set({ top, left: Math.round(pulse * 16), opacity: (pulse * 0.8).toFixed(2), fontSize: size });
  previous.node.style.set({ top: Math.round(-roll * 120), opacity: (0.6 * (1 - roll)).toFixed(2) });

  // The glow breathes, and flares on a click.
  const strength = 0.16 + 0.04 * Math.sin(time * 1.6) + pulse * 0.3;
  glow.style.set({ left: Math.round(view.width / 2), top: Math.round(view.height / 2), boxShadow: "0px 0px 300px " + Math.round(130 + pulse * 70) + "px " + rgb(tint, strength.toFixed(2)) });

  // The ring trails the pointer.
  const follow = 1 - Math.exp(-dt * 14);
  ringX += (view.x - ringX) * follow;
  ringY += (view.y - ringY) * follow;
  const ringSize = Math.round(28 + pulse * 30);
  pointerRing.style.set({ left: Math.round(ringX - ringSize / 2), top: Math.round(ringY - ringSize / 2), width: ringSize, height: ringSize, borderRadius: ringSize / 2, borderColor: rgb(tint, view.inside ? 0.9 : 0) });

  // Dots light up around the pointer and on the front of each click's wave. Most dots
  // are far from both in any frame, and those cost a few comparisons.
  while (waves.length && time - waves[0].at > 1.8) waves.shift();
  for (const wave of waves) {
    const age = time - wave.at;
    wave.front = age * 900;
    wave.gain = (1 - age / 1.8) * 1.2;
  }
  const shimmerTurn = Math.floor(time * 30) % 8;
  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i];
    if (dot.x > view.width + GAP || dot.y > view.height + GAP) continue;
    let energy = 0;
    if (view.inside) {
      const dx = dot.x - ringX;
      const dy = dot.y - ringY;
      const distance = dx * dx + dy * dy;
      if (distance < 70000) energy = Math.exp(-distance / 14000) * 0.7;
    }
    for (const wave of waves) {
      const dx = dot.x - wave.x;
      const dy = dot.y - wave.y;
      const band = (Math.sqrt(dx * dx + dy * dy) - wave.front) / 70;
      if (band > -2.5 && band < 2.5) energy += Math.exp(-band * band) * wave.gain;
    }
    // A slow shimmer, refreshed for an eighth of the dots each frame.
    if (i % 8 === shimmerTurn) dot.shimmer = 0.06 * Math.sin(time * 1.2 + dot.x * 0.012 + dot.y * 0.02);
    energy += dot.shimmer;
    const level = Math.round(Math.min(1, 0.12 + energy) * 20) / 20;
    const dotSize = energy > 0.35 ? (energy > 0.8 ? 6 : 4) : 2;
    if (level === dot.level && dotSize === dot.size) continue;
    dot.level = level;
    dot.size = dotSize;
    dot.node.style.set({ width: dotSize, height: dotSize, borderRadius: dotSize / 2, left: dot.x - dotSize / 2, top: dot.y - dotSize / 2, backgroundColor: rgb(energy > 0.35 ? tint : theme.ink, level) });
  }

  for (let i = rings.length - 1; i >= 0; i--) {
    const ring = rings[i];
    ring.age += dt;
    if (ring.age < 0) continue;
    const p = ring.age / 1.3;
    if (p >= 1) {
      ring.node.destroy();
      rings.splice(i, 1);
      continue;
    }
    const radius = Math.round(16 + easeOut(p) * Math.max(view.width, view.height) * 0.6);
    ring.node.style.set({ left: Math.round(ring.x) - radius, top: Math.round(ring.y) - radius, width: radius * 2, height: radius * 2, borderColor: rgb(ring.tint, (0.8 * (1 - p)).toFixed(2)) });
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const spark = sparks[i];
    spark.age += dt;
    if (spark.age >= spark.life) {
      spark.node.destroy();
      sparks.splice(i, 1);
      continue;
    }
    spark.vy += 900 * dt;
    spark.vx *= Math.exp(-dt * 1.2);
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.node.style.set({ left: Math.round(spark.x), top: Math.round(spark.y), backgroundColor: rgb(spark.tint, (1 - spark.age / spark.life).toFixed(2)) });
  }
}

applyTheme(themes.dark);
frame(0, 0);
mount(page);

const started = performance.now();
let last = started;
requestAnimationFrame(function tick(time) {
  frame((time - started) / 1000, Math.min(0.05, (time - last) / 1000));
  last = time;
  requestAnimationFrame(tick);
});
console.log("ui-js demo started");
