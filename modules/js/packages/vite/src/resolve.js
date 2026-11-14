// A ui-js realm is neither a browser nor Node: a package's `browser` or `node` build reaches
// for `document` or `process`, so resolution takes its portable one.
export const resolveOptions = {
  conditions: ["module", "development|production"],
  mainFields: ["module", "jsnext:main", "jsnext"],
};
