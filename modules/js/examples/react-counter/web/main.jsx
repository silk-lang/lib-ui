// The starter page in a browser engine: the same App.jsx, rendered by React DOM. Electron
// (electron/) and Tauri (tauri/) load the build of this, dist-web/.
import { createRoot } from "react-dom/client";
import { App } from "../src/App.jsx";

if (/Mac/.test(navigator.platform)) document.documentElement.classList.add("mac");
createRoot(document.getElementById("root")).render(<App />);

// Two animation frames after the first render (with its fonts), that frame is on screen.
// Electron prints the page's console; Tauri's shell prints what its `log` command gets.
const say = window.__TAURI__ ? (line) => window.__TAURI__.core.invoke("log", { line }) : (line) => console.log(line);
document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => say("react starter: first frame"))));
