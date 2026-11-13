// Electron shell for the benchmark app: one 400x300 window loading dist/web from files.
// The page's `bench:` console lines are printed on standard output for run.mjs.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 400,
    height: 300,
    useContentSize: true,
    title: "bench-counter",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  window.webContents.on("console-message", (event) => {
    if (event.message.startsWith("bench: ")) require("node:fs").writeSync(1, event.message + "\n");
  });
  window.loadFile(path.join(__dirname, "..", "dist", "web", "index.html"));
});
app.on("window-all-closed", () => app.quit());
