import { accent } from "./theme.js";

// Three threads woven on a gradient tile, drawn with boxes alone.
const threads = [
  { width: 40, left: 14 },
  { width: 30, left: 26 },
  { width: 40, left: 18 },
];

export function Logo({ theme }) {
  return (
    <box
      label="Silk UI"
      style={{
        position: "relative",
        width: 84,
        height: 84,
        borderRadius: 24,
        backgroundImage: accent,
        boxShadow: theme.shadow,
      }}
    >
      {threads.map((thread, i) => (
        <box
          key={i}
          style={{
            position: "absolute",
            left: thread.left,
            top: 24 + i * 14,
            width: thread.width,
            height: 8,
            borderRadius: 4,
            backgroundColor: i === 1 ? "rgba(255, 255, 255, 0.65)" : "rgb(255, 255, 255)",
          }}
        />
      ))}
    </box>
  );
}
