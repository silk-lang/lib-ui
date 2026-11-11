// The browser half of the tree parity suite. `silk task browser parity` evaluates this file
// to get the object below, calls `setup` with a case printed by ui-tree-parity, replays the
// case's inputs through the DevTools protocol, then calls `finish`, which compares what the
// page saw with what the tree reported.
({
  // Builds the case's page and logs, for each element that listens, `type:target>current`.
  setup(test) {
    document.head.innerHTML = "<style>html,body{margin:0}</style>";
    // The tree's root is the page's body: it is where a key goes when nothing has focus.
    const parsed = document.createElement("template");
    parsed.innerHTML = test.html;
    const root = parsed.content.firstElementChild;
    for (const name of document.body.getAttributeNames()) {
      document.body.removeAttribute(name);
    }
    for (const name of root.getAttributeNames()) {
      document.body.setAttribute(name, root.getAttribute(name));
    }
    document.body.replaceChildren(...root.childNodes);
    const log = [];
    window.parityLog = log;
    for (const element of document.querySelectorAll("[data-listen]")) {
      for (const type of element.dataset.listen.split(" ")) {
        element.addEventListener(type, (event) => {
          log.push(`${event.type}:${event.target.id || ""}>${event.currentTarget.id}`);
        });
      }
    }
    return new Promise((resolve) => requestAnimationFrame(() => resolve(true)));
  },

  // Waits for the page to settle and lists every difference from the tree's report.
  async finish(test, tolerance) {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    await frame();
    await frame();
    const differences = [];
    const events = window.parityLog;
    if (JSON.stringify(events) !== JSON.stringify(test.events)) {
      differences.push({ what: "events", tree: test.events, chrome: events });
    }
    const near = (a, b) => a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);
    for (const [id, expected] of Object.entries(test.rects)) {
      const element = document.getElementById(id);
      if (!element) {
        differences.push({ what: "rect", id, tree: expected, chrome: null });
        continue;
      }
      const box = element.getBoundingClientRect();
      const measured = [box.x, box.y, box.width, box.height];
      if (!near(expected, measured)) {
        differences.push({ what: "rect", id, tree: expected, chrome: measured });
      }
    }
    for (const [id, expected] of Object.entries(test.scroll)) {
      const element = document.getElementById(id);
      if (!element) {
        continue;
      }
      const measured = [element.scrollLeft, element.scrollTop];
      if (!near(expected, measured)) {
        differences.push({ what: "scroll", id, tree: expected, chrome: measured });
      }
    }
    const active = document.activeElement;
    const focus = active && active !== document.body ? active.id : "";
    if (focus !== test.focus) {
      differences.push({ what: "focus", tree: test.focus, chrome: focus });
    }
    return { name: test.name, differences };
  },
})
