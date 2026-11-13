// The getHostSibling patch (src/reconciler.js) must not change what React does: random
// list edits run through the original and the patched reconciler, and every host
// operation must match.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { isReconciler, patchReconciler } from "../src/reconciler.js";

const require = createRequire(import.meta.url);
const React = require("react");
const h = React.createElement;

/** The reconciler factory from `file`, its source patched or not. */
function load(file, patched) {
  let code = readFileSync(file, "utf8");
  if (patched) {
    const next = patchReconciler(code);
    assert.ok(next, "the patch applies to " + file);
    code = next;
  }
  const module = { exports: {} };
  const local = createRequire(file);
  new Function("module", "exports", "require", "process", code)(module, module.exports, local, {
    env: { NODE_ENV: file.includes(".development.") ? "development" : "production" },
  });
  return module.exports;
}

/** A host that records every operation, with nodes named by creation order. */
function makeHost(log) {
  let next = 0;
  const node = (type, text) => ({ id: next++, type, text, children: [] });
  const detach = (parent, child) => {
    const index = parent.children.indexOf(child);
    if (index >= 0) parent.children.splice(index, 1);
  };
  const insert = (parent, child, before) => {
    detach(parent, child);
    const index = before ? parent.children.indexOf(before) : -1;
    assert.ok(before === null || index >= 0, "insertBefore names a child of the parent");
    if (before) parent.children.splice(index, 0, child);
    else parent.children.push(child);
    log.push(`insert ${child.id} into ${parent.id} before ${before ? before.id : "end"}`);
  };
  let priority = 0;
  const config = {
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    supportsResources: false,
    supportsSingletons: false,
    supportsTestSelectors: false,
    supportsMicrotasks: true,
    isPrimaryRenderer: false,
    warnsIfNotActing: false,
    noTimeout: -1,
    getRootHostContext: () => ({}),
    getChildHostContext: (context) => context,
    getPublicInstance: (instance) => instance,
    prepareForCommit: () => null,
    resetAfterCommit() {},
    preparePortalMount() {},
    shouldSetTextContent: () => false,
    createInstance: (type) => node(type),
    createTextInstance: (text) => node("#text", text),
    appendInitialChild: (parent, child) => parent.children.push(child),
    finalizeInitialChildren: () => false,
    commitMount() {},
    commitUpdate() {},
    commitTextUpdate(instance, _previous, text) {
      instance.text = text;
    },
    resetTextContent() {},
    appendChild: (parent, child) => insert(parent, child, null),
    appendChildToContainer: (container, child) => insert(container, child, null),
    insertBefore: insert,
    insertInContainerBefore: insert,
    removeChild(parent, child) {
      detach(parent, child);
      log.push(`remove ${child.id}`);
    },
    removeChildFromContainer(container, child) {
      detach(container, child);
      log.push(`remove ${child.id}`);
    },
    clearContainer: (container) => (container.children.length = 0),
    hideInstance() {},
    unhideInstance() {},
    hideTextInstance() {},
    unhideTextInstance() {},
    detachDeletedInstance() {},
    scheduleTimeout: setTimeout,
    cancelTimeout: clearTimeout,
    scheduleMicrotask: queueMicrotask,
    setCurrentUpdatePriority(value) {
      priority = value;
    },
    getCurrentUpdatePriority: () => priority,
    resolveUpdatePriority: () => priority || 32,
    shouldAttemptEagerTransition: () => false,
    trackSchedulerEvent() {},
    resolveEventType: () => null,
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
    HostTransitionContext: React.createContext(null),
    resetFormInstance() {},
    getInstanceFromNode: () => null,
    beforeActiveInstanceBlur() {},
    afterActiveInstanceBlur() {},
    prepareScopeUpdate() {},
    getInstanceFromScope: () => null,
    bindToConsole: (method, args) => console[method].bind(console, ...args),
  };
  return { config, container: node("root") };
}

function serialize(node) {
  if (node.type === "#text") return JSON.stringify(node.text);
  return node.type + "#" + node.id + "(" + node.children.map(serialize).join(" ") + ")";
}

/** A deterministic random number generator. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function Item({ id }) {
  // Components that render one host node, several, none, or a nested fragment.
  if (id % 7 === 0) return null;
  if (id % 5 === 0) return [h("item", { key: "a" }, "a" + id), h("item", { key: "b" }, "b" + id)];
  if (id % 3 === 0) return h(React.Fragment, null, h("item", null, "f" + id));
  return h("item", null, "i" + id);
}

// Groups hold lists of items. Odd groups are fragments, so their items are placed into the
// parent's host node beside other groups' items.
function view(groups) {
  return h(
    "list",
    null,
    groups.map(({ key, items }) =>
      key % 2 === 0
        ? h("group", { key }, items.map((id) => h(Item, { key: id, id })))
        : h(React.Fragment, { key }, items.map((id) => (id % 4 === 0 ? h(Item, { key: id, id }) : h("row", { key: id }, String(id))))),
    ),
  );
}

/** Applies a random edit (insert, remove, move, reverse, append many) to `list`. */
function editList(list, next, nextId) {
  const choice = next();
  const at = Math.floor(next() * (list.length + 1));
  if (choice < 0.25) list.splice(at, 0, ...Array.from({ length: 1 + Math.floor(next() * 20) }, nextId));
  else if (choice < 0.45 && list.length > 0) list.splice(Math.min(at, list.length - 1), 1 + Math.floor(next() * 5));
  else if (choice < 0.65 && list.length > 1) {
    const [moved] = list.splice(Math.min(at, list.length - 1), 1);
    list.splice(Math.floor(next() * (list.length + 1)), 0, moved);
  } else if (choice < 0.75) list.reverse();
  else if (choice < 0.9) list.push(...Array.from({ length: Math.floor(next() * 60) }, nextId));
  else list.unshift(...Array.from({ length: 1 + Math.floor(next() * 30) }, nextId));
}

/** One commit's worth of edits: some groups' items, and sometimes the groups themselves. */
function edit(groups, next, nextId, nextGroup) {
  const count = 1 + Math.floor(next() * 3);
  for (let i = 0; i < count; i++) editList(groups[Math.floor(next() * groups.length)].items, next, nextId);
  if (next() < 0.5) {
    const keys = groups.map((group) => group.key);
    editList(keys, next, nextGroup);
    const byKey = new Map(groups.map((group) => [group.key, group]));
    groups.splice(0, groups.length, ...keys.map((key) => byKey.get(key) ?? { key, items: [nextId(), nextId()] }));
    if (groups.length === 0) groups.push({ key: nextGroup(), items: [] });
  }
}

function runEdits(factory, seed) {
  const log = [];
  const { config, container } = makeHost(log);
  const reconciler = factory(config);
  const root = reconciler.createContainer(container, 1, null, false, null, "", () => {}, () => {}, () => {}, () => {});
  const next = random(seed);
  let id = 1;
  const nextId = () => id++;
  let groupId = 0;
  const nextGroup = () => groupId++;
  const groups = Array.from({ length: 4 }, () => ({ key: nextGroup(), items: [] }));
  const trees = [];
  for (let step = 0; step < 80; step++) {
    edit(groups, next, nextId, nextGroup);
    reconciler.updateContainerSync(view(groups.map(({ key, items }) => ({ key, items: items.slice() }))), root, null, null);
    reconciler.flushSyncWork();
    trees.push(serialize(container));
  }
  return { log, trees };
}

for (const build of ["production", "development"]) {
  const file = require.resolve(`react-reconciler/cjs/react-reconciler.${build}.js`);

  test(`the ${build} reconciler is recognized and patched once`, () => {
    assert.ok(isReconciler(file));
    const patched = patchReconciler(readFileSync(file, "utf8"));
    assert.match(patched, /silkWalkHostSibling/);
    assert.equal(patchReconciler(patched), null);
  });

  test(`the patched ${build} reconciler commits exactly what React does`, () => {
    const original = load(file, false);
    const patched = load(file, true);
    for (const seed of [1, 2, 3, 42, 1234]) {
      const expected = runEdits(original, seed);
      const actual = runEdits(patched, seed);
      assert.deepEqual(actual.trees, expected.trees, "host trees, seed " + seed);
      assert.deepEqual(actual.log, expected.log, "host operations, seed " + seed);
    }
  });
}

test("other sources are left alone", () => {
  assert.equal(isReconciler("/x/node_modules/react-dom/cjs/react-dom.production.js"), false);
  assert.equal(patchReconciler("function getHostSibling(fiber) {}"), null);
});
