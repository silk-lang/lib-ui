# @silk/vite

Vite plugin for ui-js applications: a library build with one ES module for the host to
evaluate, and a reload of the native window after each rebuild.

```js
import { defineConfig } from "vite";
import silk from "@silk/vite";

export default defineConfig({ plugins: [silk()] });
```

| Option | Default | Meaning |
| --- | --- | --- |
| `entry` | `src/main.jsx` | Entry module, relative to the Vite root |
| `fileName` | `app.js` | Name of the bundle in `build.outDir` |
| `jsx` | `@silk/ui-react` | Package whose JSX runtime compiles JSX; `false` leaves JSX settings alone |
| `host` | none | `{ command, args, cwd }`: a host binary to start in watch mode, given `--watch <bundle>` |

`vite build` makes the production bundle. `vite build --watch --mode development` keeps
building; the plugin writes `<bundle>.stamp` after each successful build, and a host that
watches it reloads the application. See [the ui-js README](../../README.md#silkvite).
