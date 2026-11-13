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
| `host` | none | `{ command, args, cwd }`: a host binary to start, given `--dev <port>` under the dev server and `--watch <bundle>` in watch mode |
| `refresh` | `true` | React Fast Refresh under the dev server |
| `port` | any free one | Port the dev server listens on for the host |

- `vite build` makes the production bundle.
- `vite` serves the modules to the host and replaces the ones an edit touches. Component
  files keep their state (React Fast Refresh); other edits restart the application.
- `vite build --watch --mode development` keeps building the bundle and writes
  `<bundle>.stamp` after each successful build; a host that watches it reloads the whole
  application.

See [the ui-js README](../../README.md#silkvite).
