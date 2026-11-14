// The browser's elements for the benchmark app.
export const Box = "div";
export const Input = "input";
export const inputValue = (event) => event.target.value;

// Two animation frames after a commit, the frame holding it has been drawn. Electron's
// shell prints the page's `bench:` console lines; under Tauri the line goes to the shell's
// `bench` command, which prints it.
export function mark(label) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const line = "bench: " + label;
      if (window.__TAURI__) window.__TAURI__.core.invoke("bench", { line });
      else console.log(line);
    }),
  );
}
