import { useEffect, useState } from "react";
import { createRoot } from "@silk/ui-react";

function Counter() {
  const [clicks, setClicks] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [name, setName] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <box style={{ padding: 24, gap: 16, display: "flex", flexDirection: "column" }}>
      <box
        testId="counter"
        tabIndex={0}
        style={{ width: 180, height: 70, padding: 12, borderRadius: 8, fontSize: 24, color: "white", backgroundColor: "rgb(0, 100, 200)" }}
        hoverStyle={{ backgroundColor: "rgb(0, 120, 230)" }}
        activeStyle={{ backgroundColor: "rgb(0, 80, 170)" }}
        onClick={() => setClicks(clicks + 1)}
      >
        {clicks === 0 ? "Click me" : clicks === 1 ? "Clicked" : "Clicked " + clicks + " times"}
      </box>
      <input
        testId="name"
        placeholder="Your name"
        value={name}
        onInput={(event) => setName(event.value.toUpperCase())}
        style={{ width: 200, height: 30, borderWidth: 1, borderStyle: "solid", borderColor: "rgb(150, 150, 150)" }}
      />
      <box style={{ fontSize: 14 }}>
        {name ? "Hello " + name + ". " : ""}Open for {seconds} s
      </box>
    </box>
  );
}

createRoot().render(<Counter />);
console.log("react counter started");
