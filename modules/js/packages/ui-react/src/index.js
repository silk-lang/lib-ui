// @silk/ui-react: a React renderer for the Silk UI tree.
//
// Host elements are the tree's node kinds: <box>, <input>, <image>, <icon>, <canvas>.
// Strings in children become text nodes. Props:
//
// - `style`, and `hoverStyle`, `activeStyle`, `focusStyle`, `focusVisibleStyle` for the
//   looks the tree lays over it in those states.
// - `onClick`, `onPointerDown`, `onKeyDown`, `onInput` and so on for every event of the
//   tree, with a `Capture` suffix for the capture phase. Listeners receive the @silk/ui
//   event, which has the DOM members.
// - `value` on <input>: a controlled value, as in React DOM.
// - Everything else is a tree attribute: `tabIndex`, `testId`, `label`, `disabled`,
//   `placeholder` and so on, and `role` and `aria-*` as in React DOM.
import Reconciler from "react-reconciler";
import {
  ConcurrentRoot,
  ContinuousEventPriority,
  DefaultEventPriority,
  DiscreteEventPriority,
} from "react-reconciler/constants.js";
import { createContext } from "react";
import { createNode, createText, mount, root as mountedRoot } from "@silk/ui";

const LOOKS = { style: "base", hoverStyle: "hover", activeStyle: "active", focusStyle: "focus", focusVisibleStyle: "focusVisible" };
const CONTINUOUS = new Set(["pointermove", "pointerenter", "pointerleave", "wheel", "scroll", "layout"]);
const SKIP = new Set(["children", "key", "ref", "value", "defaultValue"]);

let updatePriority = 0;
let eventPriority = 0;
let currentEvent = null;

// Listeners per node: one registered function per event and phase, which calls whatever
// the latest props hold.
const bindings = new WeakMap();

function eventOf(name) {
  if (name.length < 3 || name[0] !== "o" || name[1] !== "n" || name[2] < "A" || name[2] > "Z") return null;
  const capture = name.endsWith("Capture");
  const type = (capture ? name.slice(2, -7) : name.slice(2)).toLowerCase();
  return { type, capture };
}

function listen(node, name, type, capture) {
  let bound = bindings.get(node);
  if (!bound) bindings.set(node, (bound = { props: {}, names: new Set() }));
  if (bound.names.has(name)) return;
  bound.names.add(name);
  node.addEventListener(
    type,
    (event) => {
      const handler = bound.props[name];
      const previous = eventPriority;
      const previousEvent = currentEvent;
      eventPriority = CONTINUOUS.has(type) ? ContinuousEventPriority : DiscreteEventPriority;
      currentEvent = event;
      try {
        if (typeof handler === "function") handler(event);
      } finally {
        eventPriority = previous;
        currentEvent = previousEvent;
      }
      // Updates from a discrete event commit before the host applies the mutations.
      if (!CONTINUOUS.has(type)) reconciler.flushSyncWork();
      if (type === "input") restoreControlled(node);
    },
    capture,
  );
}

// A controlled input shows its `value` prop: what the user typed stays only when the
// listener put it into state.
function restoreControlled(node) {
  const props = bindings.get(node)?.props;
  if (props && props.value !== undefined && String(props.value) !== node.value) node.value = props.value;
}

function diffStyle(look, previous, next) {
  if (previous === next) return;
  // A new node takes its style as it is.
  if (!previous) {
    if (next) look.set(next);
    return;
  }
  const changes = {};
  let any = false;
  if (previous) {
    for (const name of Object.keys(previous)) {
      if (!next || !(name in next)) {
        changes[name] = null;
        any = true;
      }
    }
  }
  if (next) {
    for (const name of Object.keys(next)) {
      if (!previous || previous[name] !== next[name]) {
        changes[name] = next[name];
        any = true;
      }
    }
  }
  if (any) look.set(changes);
}

function applyProps(node, previous, next) {
  for (const name of Object.keys(next)) {
    const value = next[name];
    if (SKIP.has(name) || previous[name] === value) continue;
    if (name in LOOKS) {
      diffStyle(node.look(LOOKS[name]), previous[name], value);
      continue;
    }
    const event = eventOf(name);
    if (event) {
      if (typeof value === "function") listen(node, name, event.type, event.capture);
      continue;
    }
    node.setAttribute(name, value);
  }
  for (const name of Object.keys(previous)) {
    if (name in next || SKIP.has(name)) continue;
    if (name in LOOKS) diffStyle(node.look(LOOKS[name]), previous[name], null);
    else if (!eventOf(name)) node.setAttribute(name, name === "tabIndex" ? -2147483648 : typeof previous[name] === "boolean" ? false : "");
  }
  if (node.kind === "input") {
    if (next.value !== undefined) {
      if (String(next.value) !== node.value) node.value = next.value;
      // Typing reaches the tree first, so a controlled input needs the input event to put
      // its value back when the application does not accept the change.
      listen(node, "onInput", "input", false);
    } else if (previous === EMPTY && next.defaultValue !== undefined) {
      node.value = next.defaultValue;
    }
  }
  let bound = bindings.get(node);
  if (bound) bound.props = next;
  else if (next.value !== undefined) bindings.set(node, { props: next, names: new Set() });
}

const EMPTY = {};

const hostConfig = {
  rendererPackageName: "@silk/ui-react",
  rendererVersion: "0.1.0",
  extraDevToolsConfig: null,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsResources: false,
  supportsSingletons: false,
  supportsTestSelectors: false,
  supportsMicrotasks: true,
  isPrimaryRenderer: true,
  warnsIfNotActing: false,
  noTimeout: -1,

  getRootHostContext: () => EMPTY,
  getChildHostContext: (context) => context,
  getPublicInstance: (instance) => instance,
  prepareForCommit: () => null,
  resetAfterCommit() {},
  preparePortalMount() {},
  shouldSetTextContent: () => false,
  createInstance(type, props) {
    const node = createNode(type);
    applyProps(node, EMPTY, props);
    return node;
  },
  createTextInstance: (text) => createText(text),
  appendInitialChild: (parent, child) => parent.appendChild(child),
  finalizeInitialChildren: () => false,
  commitMount() {},
  commitUpdate(node, type, previous, next) {
    applyProps(node, previous, next);
  },
  commitTextUpdate(node, previous, next) {
    node.data = next;
  },
  resetTextContent() {},
  appendChild: (parent, child) => parent.appendChild(child),
  appendChildToContainer: (container, child) => container.appendChild(child),
  insertBefore: (parent, child, before) => parent.insertBefore(child, before),
  insertInContainerBefore: (container, child, before) => container.insertBefore(child, before),
  // React is done with a removed subtree, so its nodes are freed.
  removeChild: (parent, child) => child.destroy(),
  removeChildFromContainer: (container, child) => child.destroy(),
  clearContainer(container) {
    for (const child of container.childNodes.slice()) child.destroy();
  },
  hideInstance: (node) => node.style.set({ display: "none" }),
  unhideInstance: (node, props) => node.style.set({ display: props.style?.display ?? null }),
  hideTextInstance: (node) => (node.data = ""),
  unhideTextInstance: (node, text) => (node.data = text),
  detachDeletedInstance() {},

  scheduleTimeout: (callback, delay) => setTimeout(callback, delay),
  cancelTimeout: (id) => clearTimeout(id),
  scheduleMicrotask: (callback) => queueMicrotask(callback),

  setCurrentUpdatePriority(priority) {
    updatePriority = priority;
  },
  getCurrentUpdatePriority: () => updatePriority,
  resolveUpdatePriority: () => updatePriority || eventPriority || DefaultEventPriority,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => currentEvent?.type ?? null,
  resolveEventTimeStamp: () => -1.1,
  requestPostPaintCallback() {},

  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  suspendOnActiveViewTransition() {},
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  resetFormInstance() {},

  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  bindToConsole: (method, args) => console[method].bind(console, ...args),
};

const reconciler = Reconciler(hostConfig);
// Fast Refresh and devtools find the renderer through the global hook, when one is there.
reconciler.injectIntoDevTools?.();

function report(kind) {
  return (error, info) => {
    console.error(kind + ":", error, info?.componentStack ?? "");
  };
}

/**
 * A React root in `container`, a @silk/ui node. Without one, a new box is mounted as the
 * root of the window's tree.
 */
export function createRoot(container) {
  const host = container ?? mountedRoot() ?? mount(createNode("box"));
  const fiberRoot = reconciler.createContainer(
    host,
    ConcurrentRoot,
    null,
    false,
    null,
    "",
    report("Uncaught error"),
    report("Error caught by a boundary"),
    report("Recoverable error"),
    () => {},
  );
  return {
    // Rendering commits before it returns, so the first frame of a window has the content.
    render(element) {
      reconciler.updateContainerSync(element, fiberRoot, null, null);
      reconciler.flushSyncWork();
    },
    unmount() {
      reconciler.updateContainerSync(null, fiberRoot, null, null);
      reconciler.flushSyncWork();
    },
  };
}

/** Runs `callback` and commits the updates it made before returning. */
export function flushSync(callback) {
  return reconciler.flushSyncFromReconciler(callback);
}
