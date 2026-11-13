import { createRoot } from "@silk/ui-react";
import { App } from "./App.jsx";

createRoot().render(<App />);
// Two animation frames after the first render, that frame is on screen. The Electron and
// Tauri builds (web/main.jsx) print the same line.
requestAnimationFrame(() => requestAnimationFrame(() => console.log("react starter: first frame")));
