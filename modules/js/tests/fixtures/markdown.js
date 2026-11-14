// parseMarkdown against remark-parse 11 with remark-gfm 4: the tree the host gives for this
// sample is the one remark gives, without positions.
const sample = "# Hi *there* &amp; `code`\n\nSome **bold** and ~~gone~~ text,\na soft break and a hard  \nbreak. Visit https://example.com or [a link](/u \"T\") and ![alt *em*](i.png).\n\nA note[^Note].\n\n> quoted\n> text\n\n1. one\n2. two\n\n- [x] done\n- [ ] todo\n\n* loose\n\n* list\n\n| a | b | c |\n|:--|--:|:-:|\n| 1 | 2 | `3` |\n\n```js title=\"x\"\nlet a = \"\\n\";\n```\n\n    indented\n\n<div>\nhtml\n</div>\n\n---\n\n[^Note]: The *definition*.\n";
const expected = {"type":"root","children":[{"type":"heading","depth":1,"children":[{"type":"text","value":"Hi "},{"type":"emphasis","children":[{"type":"text","value":"there"}]},{"type":"text","value":" & "},{"type":"inlineCode","value":"code"}]},{"type":"paragraph","children":[{"type":"text","value":"Some "},{"type":"strong","children":[{"type":"text","value":"bold"}]},{"type":"text","value":" and "},{"type":"delete","children":[{"type":"text","value":"gone"}]},{"type":"text","value":" text,\na soft break and a hard"},{"type":"break"},{"type":"text","value":"break. Visit "},{"type":"link","title":null,"url":"https://example.com","children":[{"type":"text","value":"https://example.com"}]},{"type":"text","value":" or "},{"type":"link","title":"T","url":"/u","children":[{"type":"text","value":"a link"}]},{"type":"text","value":" and "},{"type":"image","title":null,"url":"i.png","alt":"alt em"},{"type":"text","value":"."}]},{"type":"paragraph","children":[{"type":"text","value":"A note"},{"type":"footnoteReference","identifier":"note","label":"Note"},{"type":"text","value":"."}]},{"type":"blockquote","children":[{"type":"paragraph","children":[{"type":"text","value":"quoted\ntext"}]}]},{"type":"list","ordered":true,"start":1,"spread":false,"children":[{"type":"listItem","spread":false,"checked":null,"children":[{"type":"paragraph","children":[{"type":"text","value":"one"}]}]},{"type":"listItem","spread":false,"checked":null,"children":[{"type":"paragraph","children":[{"type":"text","value":"two"}]}]}]},{"type":"list","ordered":false,"start":null,"spread":false,"children":[{"type":"listItem","spread":false,"checked":true,"children":[{"type":"paragraph","children":[{"type":"text","value":"done"}]}]},{"type":"listItem","spread":false,"checked":false,"children":[{"type":"paragraph","children":[{"type":"text","value":"todo"}]}]}]},{"type":"list","ordered":false,"start":null,"spread":true,"children":[{"type":"listItem","spread":false,"checked":null,"children":[{"type":"paragraph","children":[{"type":"text","value":"loose"}]}]},{"type":"listItem","spread":false,"checked":null,"children":[{"type":"paragraph","children":[{"type":"text","value":"list"}]}]}]},{"type":"table","align":["left","right","center"],"children":[{"type":"tableRow","children":[{"type":"tableCell","children":[{"type":"text","value":"a"}]},{"type":"tableCell","children":[{"type":"text","value":"b"}]},{"type":"tableCell","children":[{"type":"text","value":"c"}]}]},{"type":"tableRow","children":[{"type":"tableCell","children":[{"type":"text","value":"1"}]},{"type":"tableCell","children":[{"type":"text","value":"2"}]},{"type":"tableCell","children":[{"type":"inlineCode","value":"3"}]}]}]},{"type":"code","lang":"js","meta":"title=\"x\"","value":"let a = \"\\n\";"},{"type":"code","lang":null,"meta":null,"value":"indented"},{"type":"html","value":"<div>\nhtml\n</div>"},{"type":"thematicBreak"},{"type":"footnoteDefinition","identifier":"note","label":"Note","children":[{"type":"paragraph","children":[{"type":"text","value":"The "},{"type":"emphasis","children":[{"type":"text","value":"definition"}]},{"type":"text","value":"."}]}]}]};

function differ(path, got, want) {
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) return path + ": " + JSON.stringify(got);
    for (let i = 0; i < want.length; i++) {
      const found = differ(path + "[" + i + "]", got[i], want[i]);
      if (found) return found;
    }
    return null;
  }
  if (want && typeof want === "object") {
    if (!got || typeof got !== "object") return path + ": " + JSON.stringify(got);
    const keys = new Set([...Object.keys(want), ...Object.keys(got)]);
    for (const key of keys) {
      const found = differ(path + "." + key, got[key], want[key]);
      if (found) return found;
    }
    return null;
  }
  return got === want ? null : path + ": " + JSON.stringify(got) + " instead of " + JSON.stringify(want);
}

// 31: tables, strikethrough, task lists, autolinks and footnotes.
const found = differ("root", JSON.parse(__ui.markdown(sample, 31)), expected);
if (found) throw new Error(found);

// 96: frontmatter and GitHub alerts, which remark has no core nodes for: `yaml` is what
// remark-frontmatter gives, and an alert is a node of its own.
const extras = "---\ntitle: x\n---\n\n> [!WARNING]\n> Careful.\n";
const found2 = differ("root", JSON.parse(__ui.markdown(extras, 96)), {
  type: "root",
  children: [
    { type: "yaml", value: "title: x" },
    { type: "alert", kind: "warning", children: [{ type: "paragraph", children: [{ type: "text", value: "Careful." }] }] },
  ],
});
if (found2) throw new Error(found2);
