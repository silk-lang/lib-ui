async function observe(test, fonts, fragments, listRects) {
  document.body.style.cssText = 'margin:0;padding:0;';
  document.body.replaceChildren();
  document.fonts.clear();
  for (const font of fonts) {
    const face = new FontFace(font.family, `url(data:font/ttf;base64,${font.data})`,
      { weight: String(font.weight ?? 400), style: font.style ?? 'normal' });
    document.fonts.add(face);
    await face.load();
  }
  const fallbacks = test.fallbacks ?? [];
  const family = style => [...style.families, ...fallbacks].map(name => `"${name}"`).join(', ');
  const apply = (element, style) => {
    element.style.fontFamily = family(style);
    element.style.fontSize = `${style.size}px`;
    element.style.fontWeight = String(style.weight ?? 400);
    element.style.fontStyle = style.style ?? 'normal';
    element.style.fontSynthesis = 'none';
  };
  const block = test.block;
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;border:0;';
  container.style.width = `${block.width}px`;
  container.style.direction = block.direction ?? 'ltr';
  container.style.textAlign = block.align ?? 'start';
  container.style.lineHeight = block.lineHeight === undefined ? 'normal' : String(block.lineHeight);
  const space = block.whiteSpace ?? 'collapse';
  container.style.whiteSpace = { collapse: 'normal', preserve: 'pre-wrap', 'pre-line': 'pre-line', 'break-spaces': 'break-spaces', nowrap: 'nowrap' }[space];
  apply(container, test.styles[block.style ?? 0]);
  const texts = [];
  const build = (parent, content) => {
    for (const item of content) {
      if (typeof item === 'string') {
        const node = document.createTextNode(item);
        parent.appendChild(node);
        texts.push(node);
      } else {
        const span = document.createElement('span');
        apply(span, test.styles[item.style ?? 0]);
        if (item.bidi) { span.style.unicodeBidi = item.bidi; span.style.direction = item.direction ?? 'ltr'; }
        parent.appendChild(span);
        build(span, item.content);
      }
    }
  };
  build(container, test.content);
  document.body.appendChild(container);
  await document.fonts.ready;
  const origin = container.getBoundingClientRect();
  const utf16 = (text, byteOffset) => {
    let bytes = 0, index = 0;
    for (const character of text) {
      if (bytes >= byteOffset) break;
      const point = character.codePointAt(0);
      bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
      index += character.length;
    }
    return index;
  };
  return fragments.map(fragment => {
    const node = texts[fragment.node];
    const range = document.createRange();
    range.setStart(node, utf16(node.data, fragment.start));
    range.setEnd(node, utf16(node.data, fragment.end));
    // A range that starts or ends at a line edge also reports an empty box there.
    const rects = [...range.getClientRects()].filter(rect => rect.width > 0);
    const text = node.data.slice(utf16(node.data, fragment.start), utf16(node.data, fragment.end));
    if (!rects.length) return { missing: true, text };
    // A native fragment never crosses lines. A range next to a soft hyphen also reports the
    // generated hyphen at the end of the previous line, so keep the line with the most ink.
    const lines = new Map();
    for (const rect of rects) lines.set(rect.top, [...(lines.get(rect.top) ?? []), rect]);
    const widest = [...lines.values()].sort((a, b) => b.reduce((sum, r) => sum + r.width, 0) - a.reduce((sum, r) => sum + r.width, 0))[0];
    rects.splice(0, rects.length, ...widest);
    const left = Math.min(...rects.map(rect => rect.left)), right = Math.max(...rects.map(rect => rect.right));
    const top = Math.min(...rects.map(rect => rect.top)), bottom = Math.max(...rects.map(rect => rect.bottom));
    return { x: left - origin.left, y: top - origin.top, width: right - left, height: bottom - top, rects: rects.length, text, list: listRects ? rects.map(r => [r.left - origin.left, r.top - origin.top, r.width, r.height]) : undefined };
  });
}
