// `<box>` on the web: a div with the tree's props that React DOM does not have.
// - `ref` gets the @silk/ui-like node (silk-ui.js), not the element.
// - `hoverStyle` is laid over `style` while the pointer is on the box or inside it.
// - `href` makes it a link: a click that nothing prevented opens it.
// - `onLayout` gets `{ bounds }` when the box's size changes, and once at first.
// - `cursor` and `testId` become the CSS cursor and `data-testid`.
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { nodeOf, openUrl } from "./silk-ui.js";

export function Box({ ref, style, hoverStyle, cursor, href, testId, onLayout, onClick, onPointerEnter, onPointerLeave, ...props }) {
  const [hovered, setHovered] = useState(false);
  const element = useRef(null);
  const layout = useRef(onLayout);
  layout.current = onLayout;

  const attach = useCallback(
    (el) => {
      element.current = el;
      const node = el && nodeOf(el);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const laidOut = onLayout != null;
  useEffect(() => {
    if (!laidOut) return;
    const el = element.current;
    const observer = new ResizeObserver(() => layout.current?.({ bounds: el.getBoundingClientRect() }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [laidOut]);

  if (hoverStyle) {
    props.onPointerEnter = (event) => (setHovered(true), onPointerEnter?.(event));
    props.onPointerLeave = (event) => (setHovered(false), onPointerLeave?.(event));
  } else {
    props.onPointerEnter = onPointerEnter;
    props.onPointerLeave = onPointerLeave;
  }
  props.onClick = href
    ? (event) => {
        onClick?.(event);
        if (!event.defaultPrevented) openUrl(href);
      }
    : onClick;
  if (testId) props["data-testid"] = testId;
  props.style = hovered || cursor ? { ...style, ...(hovered ? hoverStyle : null), ...(cursor ? { cursor } : null) } : style;
  props.ref = attach;
  return createElement("div", props);
}
