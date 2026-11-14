import { createRoot } from "@silk/ui-react";
import { Counter } from "../Counter.jsx";
import { mark } from "platform";

createRoot().render(<Counter />);
mark("first frame");
