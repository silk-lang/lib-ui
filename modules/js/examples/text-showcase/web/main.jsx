// The same App.jsx in a browser, rendered by React DOM.
import { createRoot } from "react-dom/client";
import { App } from "../src/App.jsx";

createRoot(document.getElementById("root")).render(<App />);
