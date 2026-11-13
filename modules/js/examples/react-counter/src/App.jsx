import { useEffect, useRef, useState } from "react";
import { SIZE, startMotion } from "./motion.js";
import { links, mono, rgb, sans, themes } from "./theme.js";

const row = { display: "flex", flexDirection: "row", alignItems: "center" };
const column = { display: "flex", flexDirection: "column" };
const layer = { position: "absolute", inset: 0, pointerEvents: "none" };
const digit = { position: "absolute", left: 0, right: 0, top: 0, textAlign: "center", fontSize: SIZE, fontWeight: 700, lineHeight: 1, letterSpacing: -12 };

// The counter is the page: click anywhere. The count and the theme are React state, and
// what moves between clicks is drawn by motion.js on the nodes below.
export function App() {
  const [clicks, setClicks] = useState(0);
  const [streak, setStreak] = useState(0);
  const [theme, setTheme] = useState(themes.dark);
  const nodes = useRef({}).current;
  const motion = useRef(null);
  const ink = rgb(theme.ink);

  useEffect(() => {
    motion.current = startMotion(nodes, theme, clicks);
    return () => motion.current.stop();
  }, []);
  useEffect(() => motion.current.setTheme(theme), [theme]);

  const count = (event) => {
    setStreak(motion.current.click(event.clientX, event.clientY, clicks + 1));
    setClicks(clicks + 1);
  };
  const words = clicks === 0 ? "CLICK ANYWHERE" : (clicks === 1 ? "CLICKED" : "CLICKED " + clicks + " TIMES") + (streak > 2 ? "  ×" + streak : "");

  return (
    <box
      testId="counter"
      cursor="pointer"
      onClick={count}
      onLayout={(event) => motion.current?.resize(event.bounds.width, event.bounds.height)}
      onPointerMove={(event) => motion.current?.pointer(event.clientX, event.clientY)}
      style={{ position: "absolute", inset: 0, overflow: "hidden", fontFamily: sans, backgroundColor: theme.page, color: ink }}
    >
      <box ref={(node) => (nodes.field = node)} style={layer} />
      <box ref={(node) => (nodes.effects = node)} style={layer}>
        <box ref={(node) => (nodes.glow = node)} style={{ position: "absolute", width: 2, height: 2, borderRadius: 1 }} />
        <box ref={(node) => (nodes.pointerRing = node)} style={{ position: "absolute", width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderStyle: "solid" }} />
      </box>

      <box style={{ ...column, position: "absolute", inset: 0 }}>
        <TitleBar theme={theme} />
        <box style={{ ...column, alignItems: "center", justifyContent: "center", flexGrow: 1, pointerEvents: "none" }}>
          <box style={{ position: "relative", alignSelf: "stretch", height: SIZE }}>
            <box ref={(node) => (nodes.previous = node)} style={{ ...digit, color: ink, opacity: 0 }}>{String(Math.max(0, clicks - 1))}</box>
            <box ref={(node) => (nodes.ghostRed = node)} style={{ ...digit, color: "rgb(255, 40, 90)", opacity: 0 }}>{String(clicks)}</box>
            <box ref={(node) => (nodes.ghostCyan = node)} style={{ ...digit, color: "rgb(40, 220, 255)", opacity: 0 }}>{String(clicks)}</box>
            <box ref={(node) => (nodes.main = node)} style={digit}>{String(clicks)}</box>
          </box>
        </box>
        <box style={column}>
          <box style={{ ...row, justifyContent: "space-between", padding: "0 28px 18px", fontSize: 13 }}>
            <box style={{ fontFamily: mono, fontSize: 12, letterSpacing: 2, color: theme.muted }}>{words}</box>
            <box style={{ ...row, gap: 22 }}>
              {links.map((link) => (
                <Link key={link.title} theme={theme} {...link} />
              ))}
              <ThemeSwitch theme={theme} onSwitch={() => setTheme(theme === themes.dark ? themes.light : themes.dark)} />
            </box>
          </box>
          <box style={{ height: 2, backgroundColor: theme.track }}>
            <box ref={(node) => (nodes.streakBar = node)} style={{ height: 2, width: 0 }} />
          </box>
        </box>
      </box>
    </box>
  );
}

// The bar at the top is the window's title bar where the system lets the page draw it (on
// macOS the window controls sit at its left), so nothing in it takes clicks.
function TitleBar({ theme }) {
  return (
    <box style={{ ...row, position: "relative", justifyContent: "center", height: 56, flexShrink: 0 }}>
      <box style={{ ...row, gap: 10, fontWeight: 600, fontSize: 15 }}>
        <box style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: rgb(theme.ink) }} />
        Silk UI
      </box>
      <box style={{ ...row, gap: 8, position: "absolute", right: 28, top: 0, bottom: 0, fontFamily: mono, fontSize: 12, color: theme.faint }}>
        edit
        <box style={{ color: rgb(theme.ink) }}>src/App.jsx</box>
        to make it yours
      </box>
    </box>
  );
}

// A click on a link opens it and does not count.
function Link({ theme, title, href }) {
  return (
    <box
      href={href}
      tabIndex={0}
      cursor="pointer"
      onClick={(event) => event.stopPropagation()}
      style={{ whiteSpace: "nowrap", color: theme.muted }}
      hoverStyle={{ color: rgb(theme.ink) }}
    >
      {title + " ↗"}
    </box>
  );
}

function ThemeSwitch({ theme, onSwitch }) {
  return (
    <box
      testId="theme"
      tabIndex={0}
      cursor="pointer"
      onClick={(event) => {
        event.stopPropagation();
        onSwitch();
      }}
      style={{ padding: "3px 10px", borderRadius: 999, borderWidth: 1, borderStyle: "solid", borderColor: theme.track, color: theme.muted, fontFamily: mono, fontSize: 11 }}
      hoverStyle={{ borderColor: theme.faint, color: rgb(theme.ink) }}
    >
      {theme === themes.dark ? "LIGHT" : "DARK"}
    </box>
  );
}
