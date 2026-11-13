// Finds the web and Node APIs a module uses that a ui-js runtime does not have, so the
// build can say which ones an application or one of its libraries needs.
import { builtinModules } from "node:module";

/** Globals a ui-js realm lacks, by area. The areas are what a build will choose from. */
export const MISSING = {
  network: ["fetch", "Request", "Response", "Headers", "WebSocket", "XMLHttpRequest", "EventSource"],
  url: ["URL", "URLSearchParams"],
  encoding: ["TextEncoder", "TextDecoder", "atob", "btoa"],
  intl: ["Intl"],
  temporal: ["Temporal"],
  wasm: ["WebAssembly"],
  crypto: ["crypto"],
  streams: ["ReadableStream", "WritableStream", "TransformStream", "Blob", "File", "FormData"],
  events: ["Event", "EventTarget", "CustomEvent", "AbortController", "AbortSignal", "MessageChannel", "structuredClone", "DOMException"],
  workers: ["Worker"],
  storage: ["localStorage", "sessionStorage", "indexedDB"],
  dom: [
    "document", "window", "navigator", "location", "history", "MutationObserver", "ResizeObserver",
    "IntersectionObserver", "matchMedia", "getComputedStyle", "Image", "HTMLElement",
  ],
  node: ["process", "Buffer", "require", "setImmediate", "__dirname", "__filename"],
};

const AREA = new Map();
for (const [area, names] of Object.entries(MISSING)) for (const name of names) AREA.set(name, area);

const BUILTIN = new Set(builtinModules);

/** The area of global `name`, or undefined when a ui-js realm has it. */
export function areaOf(name) {
  return AREA.get(name);
}

function isNode(value) {
  return value !== null && typeof value === "object" && typeof value.type === "string";
}

/** Every binding name a pattern declares. */
function declare(pattern, declared) {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      declared.add(pattern.name);
      break;
    case "ObjectPattern":
      for (const property of pattern.properties) declare(property.type === "RestElement" ? property.argument : property.value, declared);
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) declare(element, declared);
      break;
    case "AssignmentPattern":
      declare(pattern.left, declared);
      break;
    case "RestElement":
      declare(pattern.argument, declared);
      break;
  }
}

/**
 * The missing APIs the program `ast` (ESTree) uses: global names it reads without
 * declaring them or testing for them with `typeof`, and Node builtin modules it imports.
 * A name the module declares anywhere counts as its own, whatever the scope: the scan
 * would rather miss a use than report one that is not there.
 * @returns {{ name: string, area: string }[]}
 */
export function missingApis(ast) {
  const declared = new Set();
  const guarded = new Set();
  const used = new Set();
  const modules = new Set();

  const visit = (node, parent) => {
    switch (node.type) {
      case "Identifier":
        if (AREA.has(node.name)) used.add(node.name);
        return;
      case "ImportDeclaration":
        for (const specifier of node.specifiers) declared.add(specifier.local.name);
        builtin(node.source.value);
        return;
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
        if (node.source) builtin(node.source.value);
        if (node.declaration) visit(node.declaration, node);
        return;
      case "ImportExpression":
        if (node.source.type === "Literal") builtin(node.source.value);
        break;
      case "VariableDeclarator":
        declare(node.id, declared);
        if (node.init) visit(node.init, node);
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (node.id) declared.add(node.id.name);
        for (const parameter of node.params) declare(parameter, declared);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) declared.add(node.id.name);
        break;
      case "CatchClause":
        declare(node.param, declared);
        break;
      case "UnaryExpression":
        // `typeof fetch` asks whether it is there: the module copes without it.
        if (node.operator === "typeof" && node.argument.type === "Identifier") {
          guarded.add(node.argument.name);
          return;
        }
        break;
      case "CallExpression":
        // `require("x")` is the bundler's to resolve, as an import is.
        if (node.callee.type === "Identifier" && node.callee.name === "require" && node.arguments[0]?.type === "Literal") {
          builtin(node.arguments[0].value);
          return;
        }
        break;
      case "MemberExpression":
        // `process.env.NAME` is replaced at build time.
        if (node.object.type === "Identifier" && node.object.name === "process" && !node.computed && node.property.name === "env") return;
        visit(node.object, node);
        if (node.computed) visit(node.property, node);
        return;
      case "Property":
      case "MethodDefinition":
      case "PropertyDefinition":
        if (node.computed) visit(node.key, node);
        if (node.value) visit(node.value, node);
        return;
      case "LabeledStatement":
        visit(node.body, node);
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return;
    }
    for (const key in node) {
      if (key === "type" || key === "loc" || key === "range") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) if (isNode(item)) visit(item, node);
      } else if (isNode(value)) {
        visit(value, node);
      }
    }
  };

  const builtin = (source) => {
    if (typeof source !== "string") return;
    if (source.startsWith("node:")) modules.add(source);
    else if (BUILTIN.has(source)) modules.add(`node:${source}`);
  };

  visit(ast, null);
  const found = [];
  for (const name of used) if (!declared.has(name) && !guarded.has(name)) found.push({ name, area: AREA.get(name) });
  for (const name of modules) found.push({ name, area: "node" });
  return found;
}

/** Who a module belongs to: the package under node_modules, or its path in the project. */
export function ownerOf(id, root) {
  const [file] = id.split("?");
  const marker = "/node_modules/";
  const at = file.lastIndexOf(marker);
  if (at !== -1) {
    const parts = file.slice(at + marker.length).split("/");
    if (parts[0] === ".vite") return parts[2]?.replace(/\.js$/, "") ?? file;
    return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
  }
  return file.startsWith(root) ? file.slice(root.length).replace(/^\//, "") : file;
}

/** The report of `uses` (name → { area, owners }), one line per API. */
export function report(uses) {
  const lines = ["APIs used here that a ui-js runtime does not have:"];
  const names = [...uses.keys()].sort((a, b) => uses.get(a).area.localeCompare(uses.get(b).area) || a.localeCompare(b));
  for (const name of names) {
    const { area, owners } = uses.get(name);
    lines.push(`  ${name} (${area}): ${[...owners].sort().join(", ")}`);
  }
  lines.push("Code that reaches them fails when it runs. Pass `apis: \"off\"` to silence this, or `allow` for names the application provides itself.");
  return lines.join("\n");
}
