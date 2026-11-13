// Everything on the page that moves. React renders the page once per click; this draws
// every frame, straight on the nodes React made (it gets them by ref) and on nodes of its
// own for the dots, the rings and the sparks.
import { createBox } from "@silk/ui";
import { rgb } from "./theme.js";

export const SIZE = 340; // the number's font size at rest
const GAP = 44; // between dots
const easeOut = (p) => 1 - Math.pow(1 - p, 3);

/**
 * Starts the motion on `nodes`: `field` and `effects` (empty layers), `glow`,
 * `pointerRing`, `streakBar`, and the number's copies `main`, `ghostRed`, `ghostCyan` and
 * `previous`. Returns `click(x, y, clicks)`, `setTheme(theme)`, `resize`, `pointer` and
 * `stop`.
 */
export function startMotion(nodes, theme, clicks) {
  const view = { width: 1040, height: 720, x: 520, y: 360, inside: false };
  let pulse = 0; // 1 at a click, fading
  let streak = 0; // fast clicks in a row
  let lastClick = -10;
  let rolledAt = -10;
  let now = 0;
  let ringX = view.x;
  let ringY = view.y;
  const tint = () => theme.colors[clicks % theme.colors.length];

  // Many nodes fade here, so they fade by the alpha of their color.
  const dots = [];
  for (let r = 0; r < 26; r++) {
    for (let c = 0; c < 40; c++) {
      const node = createBox({ position: "absolute", left: c * GAP + 20, top: r * GAP + 18, width: 2, height: 2, borderRadius: 1 });
      nodes.field.append(node);
      dots.push({ node, x: c * GAP + 21, y: r * GAP + 19, level: -1, size: 2 });
    }
  }
  const waves = [];
  const rings = [];
  const sparks = [];

  function frame(time, dt) {
    now = time;
    const color = tint();
    pulse *= Math.exp(-dt * 4.5);
    if (time - lastClick > 0.7) streak = Math.max(0, streak - dt * 6);
    nodes.streakBar.style.set({ width: Math.round(view.width * Math.min(1, streak / 12)), backgroundColor: rgb(color) });

    // The number: it rolls in from below, pops, splits into colors, and shakes on a streak.
    const roll = easeOut(Math.min(1, (time - rolledAt) / 0.32));
    const shake = pulse * Math.min(10, streak * 1.6);
    const size = Math.round(SIZE * (1 + pulse * 0.07));
    const top = Math.round((1 - roll) * 120);
    nodes.main.style.set({ top: top + Math.round((Math.random() - 0.5) * shake), left: Math.round((Math.random() - 0.5) * shake), opacity: roll.toFixed(2), color: rgb(color), fontSize: size });
    nodes.ghostRed.style.set({ top, left: Math.round(-pulse * 16), opacity: (pulse * 0.8).toFixed(2), fontSize: size });
    nodes.ghostCyan.style.set({ top, left: Math.round(pulse * 16), opacity: (pulse * 0.8).toFixed(2), fontSize: size });
    nodes.previous.style.set({ top: Math.round(-roll * 120), opacity: (0.6 * (1 - roll)).toFixed(2) });

    // The glow breathes, and flares on a click.
    const strength = 0.16 + 0.04 * Math.sin(time * 1.6) + pulse * 0.3;
    nodes.glow.style.set({ left: Math.round(view.width / 2), top: Math.round(view.height / 2), boxShadow: "0px 0px 300px " + Math.round(130 + pulse * 70) + "px " + rgb(color, strength.toFixed(2)) });

    // The ring trails the pointer.
    const follow = 1 - Math.exp(-dt * 14);
    ringX += (view.x - ringX) * follow;
    ringY += (view.y - ringY) * follow;
    const ringSize = Math.round(28 + pulse * 30);
    nodes.pointerRing.style.set({ left: Math.round(ringX - ringSize / 2), top: Math.round(ringY - ringSize / 2), width: ringSize, height: ringSize, borderRadius: ringSize / 2, borderColor: rgb(color, view.inside ? 0.9 : 0) });

    // Dots light up around the pointer and on the front of each click's wave.
    while (waves.length && time - waves[0].at > 1.8) waves.shift();
    for (const dot of dots) {
      if (dot.x > view.width + GAP || dot.y > view.height + GAP) continue;
      const dx = dot.x - ringX;
      const dy = dot.y - ringY;
      let energy = view.inside ? Math.exp(-(dx * dx + dy * dy) / 14000) * 0.7 : 0;
      for (const wave of waves) {
        const age = time - wave.at;
        const band = (Math.hypot(dot.x - wave.x, dot.y - wave.y) - age * 900) / 70;
        energy += Math.exp(-band * band) * (1 - age / 1.8) * 1.2;
      }
      energy += 0.06 * Math.sin(time * 1.2 + dot.x * 0.012 + dot.y * 0.02);
      const level = Math.round(Math.min(1, 0.12 + energy) * 20) / 20;
      const dotSize = energy > 0.35 ? (energy > 0.8 ? 6 : 4) : 2;
      if (level === dot.level && dotSize === dot.size) continue;
      dot.level = level;
      dot.size = dotSize;
      dot.node.style.set({ width: dotSize, height: dotSize, borderRadius: dotSize / 2, left: dot.x - dotSize / 2, top: dot.y - dotSize / 2, backgroundColor: rgb(energy > 0.35 ? color : theme.ink, level) });
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
      ring.node.style.set({ left: Math.round(ring.x) - radius, top: Math.round(ring.y) - radius, width: radius * 2, height: radius * 2, borderColor: rgb(ring.color, (0.8 * (1 - p)).toFixed(2)) });
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
      spark.node.style.set({ left: Math.round(spark.x), top: Math.round(spark.y), backgroundColor: rgb(spark.color, (1 - spark.age / spark.life).toFixed(2)) });
    }
  }

  frame(0, 0);
  const started = performance.now();
  let last = started;
  let request = requestAnimationFrame(function tick(time) {
    frame((time - started) / 1000, Math.min(0.05, (time - last) / 1000));
    last = time;
    request = requestAnimationFrame(tick);
  });

  return {
    /** A click at (x, y) that made the count `next`. Returns the streak it is part of. */
    click(x, y, next) {
      streak = now - lastClick < 0.7 ? Math.min(12, streak + 1) : 1;
      lastClick = now;
      rolledAt = now;
      pulse = 1;
      clicks = next;
      const color = tint();
      waves.push({ x, y, at: now });
      for (let i = 0; i < 3; i++) {
        const node = createBox({ position: "absolute", borderRadius: 9999, borderWidth: i === 0 ? 3 : 1, borderStyle: "solid", borderColor: rgb(color, 0) });
        nodes.effects.append(node);
        rings.push({ node, x, y, age: -i * 0.1, color });
      }
      for (let i = 0, count = 14 + streak * 3; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 260 + Math.random() * 620;
        const size = 3 + Math.random() * 7;
        const node = createBox({ position: "absolute", width: size, height: size, borderRadius: Math.random() < 0.5 ? size / 2 : 1 });
        nodes.effects.append(node);
        sparks.push({ node, color: Math.random() < 0.3 ? theme.ink : color, x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 180, age: 0, life: 0.7 + Math.random() * 0.7 });
      }
      return streak;
    },
    setTheme(next) {
      theme = next;
      for (const dot of dots) dot.level = -1;
    },
    resize(width, height) {
      view.width = width;
      view.height = height;
    },
    pointer(x, y) {
      view.x = x;
      view.y = y;
      view.inside = true;
    },
    stop() {
      cancelAnimationFrame(request);
      for (const item of [...dots, ...rings, ...sparks]) item.node.destroy();
    },
  };
}
