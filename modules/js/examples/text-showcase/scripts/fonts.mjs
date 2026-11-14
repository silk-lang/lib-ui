// Downloads the page's fonts from Google Fonts into fonts/ (not in git): `npm run fonts`.
// Both hosts draw with these same files: the ui-js window takes the directory with
// `--fonts`, and the browser build declares each one with @font-face (fonts/fonts.css).
import { mkdir, writeFile } from "node:fs/promises";

const families = [
  "Noto Serif Display:ital,wght@0,400;0,700;1,400",
  "Noto Serif:ital,wght@0,400;0,700;1,400",
  "Noto Naskh Arabic:wght@400;700",
  "Noto Serif Hebrew:wght@400;700",
  "Noto Serif Devanagari:wght@400;700",
  "Noto Serif Thai:wght@400;700",
  "Noto Serif JP:wght@400;700",
  "Noto Serif KR:wght@400",
  "Noto Sans Mongolian",
];
// Twemoji in COLR version 0 layers: the tree does not draw COLR version 1 paint graphs yet,
// which is what Google's Noto Color Emoji is.
const files = [["Twemoji Mozilla", "https://github.com/mozilla/twemoji-colr/releases/download/v0.7.0/Twemoji.Mozilla.ttf"]];

const dir = new URL("../fonts/", import.meta.url);
await mkdir(dir, { recursive: true });
let css = "";
for (const family of families) {
  // Without a browser's user agent Google Fonts serves whole TrueType files, which every
  // host reads.
  const query = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(family).replace(/%20/g, "+");
  const sheet = await (await fetch(query)).text();
  for (const rule of sheet.match(/@font-face\s*{[^}]*}/g) ?? []) {
    const name = rule.match(/font-family:\s*'([^']+)'/)[1];
    const style = rule.match(/font-style:\s*(\w+)/)[1];
    const weight = rule.match(/font-weight:\s*(\d+)/)[1];
    const url = rule.match(/url\((\S+?)\)/)[1];
    const file = name.replace(/ /g, "") + "-" + weight + (style === "italic" ? "i" : "") + ".ttf";
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    await writeFile(new URL(file, dir), bytes);
    css += `@font-face { font-family: "${name}"; font-style: ${style}; font-weight: ${weight}; src: url("./${file}"); font-display: block; }\n`;
    console.log(file, (bytes.length / 1048576).toFixed(1) + " MB");
  }
}
for (const [name, url] of files) {
  const file = name.replace(/ /g, "") + ".ttf";
  await writeFile(new URL(file, dir), new Uint8Array(await (await fetch(url)).arrayBuffer()));
  css += `@font-face { font-family: "${name}"; src: url("./${file}"); font-display: block; }\n`;
  console.log(file);
}
await writeFile(new URL("fonts.css", dir), css);
