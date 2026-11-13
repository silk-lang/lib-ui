// The JSX runtime of the web build: React's, with `<box>` as Box (box.js). The page's
// components are compiled against it unchanged (vite.web.config.js).
import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from "react/jsx-runtime";
import { Box } from "./box.js";

const host = (type) => (type === "box" ? Box : type);
export { Fragment };
export const jsx = (type, props, key) => reactJsx(host(type), props, key);
export const jsxs = (type, props, key) => reactJsxs(host(type), props, key);
export const jsxDEV = (type, props, key) => reactJsx(host(type), props, key);
