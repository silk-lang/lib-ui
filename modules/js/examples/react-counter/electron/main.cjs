// The starter page in Electron: the same window as the ui-js demo (1040x720, "Silk UI", the
// page drawing its own title bar on macOS) loading the web build, ../dist-web. Links open in
// the system browser, and the page's console is printed on standard output.
const { app, BrowserWindow, shell } = require("electron");
const { writeSync } = require("node:fs");
const path = require("node:path");

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    useContentSize: true,
    title: "Silk UI",
    backgroundColor: "#040405",
    autoHideMenuBar: true,
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden", trafficLightPosition: { x: 20, y: 21 } } : {}),
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("console-message", (event) => writeSync(1, event.message + "\n"));
  window.loadFile(path.join(__dirname, "..", "dist-web", "index.html"));
});
app.on("window-all-closed", () => app.quit());
