import { useEffect, useState } from "react";
import { accent, accentActive, accentHover } from "./theme.js";

export function Counter({ theme }) {
  const [clicks, setClicks] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [name, setName] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <box style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginTop: 6 }}>
      <box style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}>
        <box
          testId="counter"
          tabIndex={0}
          cursor="pointer"
          style={{
            display: "flex",
            justifyContent: "center",
            minWidth: 180,
            padding: "12px 22px",
            borderRadius: 999,
            fontSize: 15,
            fontWeight: 700,
            color: "white",
            backgroundImage: accent,
          }}
          hoverStyle={{ backgroundImage: accentHover }}
          activeStyle={{ backgroundImage: accentActive }}
          onClick={() => setClicks(clicks + 1)}
        >
          {clicks === 0 ? "Click me" : clicks === 1 ? "Clicked" : "Clicked " + clicks + " times"}
        </box>
        <input
          testId="name"
          placeholder="Your name"
          value={name}
          onInput={(event) => setName(event.value.toUpperCase())}
          style={{
            width: 200,
            padding: "11px 16px",
            borderRadius: 999,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: theme.border,
            backgroundColor: theme.field,
            color: theme.text,
            fontSize: 15,
          }}
          hoverStyle={{ borderColor: theme.borderHover }}
          focusStyle={{ borderColor: "rgb(139, 92, 246)" }}
        />
      </box>
      <box style={{ fontSize: 13, color: theme.faint }}>
        {name ? "Hello " + name + ". " : ""}Open for {seconds} s
      </box>
    </box>
  );
}
