import { useState } from "react";
import { Counter } from "./Counter.jsx";
import { Logo } from "./Logo.jsx";
import { docs, themes } from "./theme.js";

const links = [
  { title: "Docs", href: docs + "/", text: "Find out how Silk UI works, from the tree to whole apps." },
  { title: "Tutorial", href: docs + "/core/tutorial/", text: "Build a complete app in five short steps." },
  { title: "Native apps", href: docs + "/native/", text: "Windows, input and the GPU, without a browser." },
  { title: "UI tree", href: docs + "/tree/", text: "The retained tree this page is drawn with." },
];

export function App() {
  const [theme, setTheme] = useState(themes.dark);
  const other = theme.name === "dark" ? themes.light : themes.dark;

  return (
    <box
      style={{
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        inset: 0,
        overflowY: "auto",
        backgroundColor: theme.page,
        color: theme.text,
        fontSize: 14,
      }}
    >
      <box style={{ display: "flex", flexDirection: "column", flexGrow: 1, padding: "28px 40px", gap: 32, backgroundImage: theme.glow }}>
        <Header theme={theme} other={other} onToggle={() => setTheme(other)} />
        <Hero theme={theme} />
        <Cards theme={theme} />
      </box>
      <Footer theme={theme} />
    </box>
  );
}

function Header({ theme, other, onToggle }) {
  return (
    <box style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
      <box
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 999,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: theme.border,
          backgroundColor: theme.surface,
          color: theme.muted,
          fontSize: 13,
        }}
      >
        Get started by editing
        <box style={{ padding: "2px 8px", borderRadius: 6, backgroundColor: theme.code, color: theme.text, fontFamily: "monospace" }}>
          src/App.jsx
        </box>
      </box>
      <box
        testId="theme"
        tabIndex={0}
        cursor="pointer"
        onClick={onToggle}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          padding: "8px 14px",
          borderRadius: 999,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: theme.border,
          backgroundColor: theme.surface,
          color: theme.muted,
          fontSize: 13,
        }}
        hoverStyle={{ borderColor: theme.borderHover, color: theme.text }}
        focusVisibleStyle={{ borderColor: "rgb(139, 92, 246)" }}
      >
        <box style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: other.page, borderWidth: 1, borderStyle: "solid", borderColor: theme.borderHover }} />
        {other.name === "light" ? "Light mode" : "Dark mode"}
      </box>
    </box>
  );
}

function Hero({ theme }) {
  return (
    <box style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, flexGrow: 1, justifyContent: "center" }}>
      <Logo theme={theme} />
      <box style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <box style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1 }}>Silk UI</box>
        <box style={{ fontSize: 18, color: theme.muted, textAlign: "center", maxWidth: 520 }}>
          Native apps in React and JavaScript. No browser inside, just a fast UI tree on the GPU.
        </box>
      </box>
      <Counter theme={theme} />
    </box>
  );
}

function Cards({ theme }) {
  return (
    <box style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
      {links.map((link) => (
        <Card key={link.title} theme={theme} {...link} />
      ))}
    </box>
  );
}

function Card({ theme, title, href, text }) {
  return (
    <box
      href={href}
      label={title}
      tabIndex={0}
      cursor="pointer"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        flexGrow: 1,
        flexBasis: 0,
        minWidth: 180,
        padding: "18px 20px",
        borderRadius: 14,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: theme.border,
        backgroundColor: theme.surface,
      }}
      hoverStyle={{ borderColor: theme.borderHover, backgroundColor: theme.surfaceHover }}
      activeStyle={{ borderColor: "rgb(139, 92, 246)" }}
      focusVisibleStyle={{ borderColor: "rgb(139, 92, 246)" }}
    >
      <box style={{ fontSize: 17, fontWeight: 700 }}>{title} →</box>
      <box style={{ color: theme.muted, lineHeight: 1.45 }}>{text}</box>
    </box>
  );
}

function Footer({ theme }) {
  return (
    <box
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        padding: "14px 40px",
        borderTopWidth: 1,
        borderTopStyle: "solid",
        borderTopColor: theme.border,
        color: theme.faint,
        fontSize: 12,
      }}
    >
      React 19 on the SilkJS engine, drawn by the Silk UI tree.
    </box>
  );
}
