// The two looks of the page. `ink` is the color of the dots, the text and the number at
// zero; `colors` are what the number cycles through, one per click.
export const themes = {
  dark: {
    name: "dark",
    page: "rgb(4, 4, 5)",
    ink: [250, 250, 250],
    muted: "rgb(161, 161, 170)",
    faint: "rgb(113, 113, 122)",
    track: "rgb(24, 24, 27)",
    colors: [[250, 250, 250], [163, 230, 53], [34, 211, 238], [167, 139, 250], [251, 113, 133], [251, 191, 36]],
  },
  light: {
    name: "light",
    page: "rgb(250, 250, 250)",
    ink: [9, 9, 11],
    muted: "rgb(82, 82, 91)",
    faint: "rgb(113, 113, 122)",
    track: "rgb(228, 228, 231)",
    colors: [[9, 9, 11], [77, 124, 15], [8, 145, 178], [124, 58, 237], [225, 29, 72], [217, 119, 6]],
  },
};

export const rgb = (color, alpha = 1) => "rgba(" + color[0] + "," + color[1] + "," + color[2] + "," + alpha + ")";

export const sans = "Geist, Noto Sans, sans-serif";
export const mono = "Geist Mono, monospace";

const docs = "https://silk-ui-docs.juliaortiz-js.workers.dev";
export const links = [
  { title: "Docs", href: docs + "/" },
  { title: "Tutorial", href: docs + "/core/tutorial/" },
  { title: "Native apps", href: docs + "/native/" },
  { title: "UI tree", href: docs + "/tree/" },
];
