// A speed fix for React's reconciler, applied to its source as the app is bundled.
//
// When React commits a placement it looks for the host node to insert before:
// getHostSibling walks the following siblings and skips every one that is itself being
// placed. When a commit adds n children to one parent, the first placement walks n - 1
// siblings, the second n - 2, and so on: n²/2 steps, about 500,000 for 1,000 rows. A JIT
// makes each step a few nanoseconds; an interpreter spends most of the commit there.
//
// Placements run in sibling order, so consecutive calls repeat the same walk. The patch
// remembers the answer of the last walk that started by skipping a sibling being placed,
// and the sibling after it: when the next call starts from that sibling, and that sibling
// is still being placed, the walk would end at the same answer. Any other call walks as
// before. Each commit starts with nothing remembered.

const FILE = /[\\/]react-reconciler[\\/]cjs[\\/]react-reconciler\.(production|development|profiling)\.js$/;
const DEFINITION = /function getHostSibling\(fiber\) \{/;
const COMMIT = /prepareForCommit\(root\.containerInfo\);/;

const REPLACEMENT = `var silkSiblingFrom = null, silkSiblingAnswer = null;
function getHostSibling(fiber) {
  var next = fiber.sibling, answer;
  if (null !== next && next === silkSiblingFrom && next.flags & 2) answer = silkSiblingAnswer;
  else answer = silkWalkHostSibling(fiber);
  if (null !== next && next.flags & 2) {
    silkSiblingFrom = null !== next.sibling && next.sibling.flags & 2 ? next.sibling : null;
    silkSiblingAnswer = answer;
  } else silkSiblingFrom = null;
  return answer;
}
function silkWalkHostSibling(fiber) {`;

/** Whether `id` is one of react-reconciler's builds. */
export function isReconciler(id) {
  return FILE.test(id.split("?")[0]);
}

/**
 * The reconciler's source with the patch applied, or null when the source does not have
 * the shape the patch expects (another React version): then it is left as it is.
 */
export function patchReconciler(code) {
  if (code.includes("silkWalkHostSibling")) return null;
  if (!DEFINITION.test(code) || !COMMIT.test(code)) return null;
  return code
    .replace(DEFINITION, REPLACEMENT)
    .replace(COMMIT, "silkSiblingFrom = null;\n    prepareForCommit(root.containerInfo);");
}

/** A Vite (and Rolldown) plugin applying patchReconciler. */
export function reconcilerPlugin() {
  let warned = false;
  return {
    name: "silk:react-reconciler",
    transform(code, id) {
      if (!isReconciler(id)) return;
      const patched = patchReconciler(code);
      if (patched === null) {
        if (!warned && !code.includes("silkWalkHostSibling")) {
          warned = true;
          this.warn("react-reconciler does not have the expected getHostSibling: its commits keep their quadratic sibling walk");
        }
        return;
      }
      return { code: patched, map: null };
    },
  };
}
