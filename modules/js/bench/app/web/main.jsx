import { createRoot } from "react-dom/client";
import { Counter } from "../Counter.jsx";
import { mark } from "platform";

createRoot(document.getElementById("root")).render(<Counter />);
mark("first frame");
