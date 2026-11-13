// The tree's host elements for the benchmark app.
export const Box = "box";
export const Input = "input";
export const inputValue = (event) => event.value;

// Two animation frames after a commit, the frame holding it has been drawn.
export function mark(label) {
  requestAnimationFrame(() => requestAnimationFrame(() => console.log("bench: " + label)));
}
