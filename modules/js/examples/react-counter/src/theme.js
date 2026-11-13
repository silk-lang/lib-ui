// The two looks of the starter page. Every color the page draws comes from here.
export const themes = {
  dark: {
    name: "dark",
    page: "rgb(9, 9, 11)",
    glow: "linear-gradient(180deg, rgba(124, 58, 237, 0.20), rgba(9, 9, 11, 0))",
    text: "rgb(250, 250, 250)",
    muted: "rgb(161, 161, 170)",
    faint: "rgb(113, 113, 122)",
    surface: "rgba(255, 255, 255, 0.03)",
    surfaceHover: "rgba(255, 255, 255, 0.07)",
    border: "rgba(255, 255, 255, 0.10)",
    borderHover: "rgba(255, 255, 255, 0.22)",
    code: "rgba(255, 255, 255, 0.08)",
    field: "rgba(255, 255, 255, 0.05)",
    shadow: "0px 0px 48px 0px rgba(139, 92, 246, 0.45)",
  },
  light: {
    name: "light",
    page: "rgb(250, 250, 250)",
    glow: "linear-gradient(180deg, rgba(124, 58, 237, 0.10), rgba(250, 250, 250, 0))",
    text: "rgb(9, 9, 11)",
    muted: "rgb(82, 82, 91)",
    faint: "rgb(113, 113, 122)",
    surface: "rgba(255, 255, 255, 0.9)",
    surfaceHover: "rgb(255, 255, 255)",
    border: "rgba(0, 0, 0, 0.08)",
    borderHover: "rgba(0, 0, 0, 0.20)",
    code: "rgba(0, 0, 0, 0.06)",
    field: "rgb(255, 255, 255)",
    shadow: "0px 12px 40px 0px rgba(124, 58, 237, 0.30)",
  },
};

export const accent = "linear-gradient(135deg, rgb(139, 92, 246), rgb(6, 182, 212))";
export const accentHover = "linear-gradient(135deg, rgb(157, 116, 255), rgb(34, 211, 238))";
export const accentActive = "linear-gradient(135deg, rgb(109, 40, 217), rgb(8, 145, 178))";

export const docs = "https://silk-ui-docs.juliaortiz-js.workers.dev";
