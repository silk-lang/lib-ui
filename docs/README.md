# The Silk UI docs

The documentation site: three guides, written in Markdown, shown by a Silk UI program. The
site is itself a Silk UI app. Its WebAssembly build is the page readers get, and its native
build writes one `index.html` per route, which the program hydrates when it loads.

```sh
docs/build.sh serve   # builds into docs/dist and serves http://localhost:8017
```

## Layout

| Path | What it is |
| --- | --- |
| `content/core`, `content/native`, `content/tree` | The pages, one Markdown file each |
| `examples/src` | Every program the pages show, as one library (`ui-docs-examples`) |
| `examples/apps` | The same programs with a `main`: native windows, a browser page, a headless tree |
| `tests` | Tests of the examples. `silk task unit-tests` runs them |
| `shots` | A tool that runs the examples with no window and writes the pictures the pages use |
| `live` | The window examples as one wasm module for a WebGPU canvas. Where the browser can run it, `web/index.html` puts `live/?app=…` in a frame in place of the example's picture |
| `src` | The site program: Markdown reader, code colors, page shell, live demos |
| `web` | The HTML shell, fonts and favicon |
| `wrangler.jsonc` | The Cloudflare deployment |

## Writing a page

A page is a Markdown file. The first `#` heading is its title and the paragraph after it is
its lead. Besides ordinary Markdown there are three directives, each on a line of its own:

```
::demo counter
::source examples/src/core/counter.silk "impl Program"
::shot native-pad "Pad, with its menu bar"
```

- `::demo name` runs a program inside the page. Demos are listed in `src/demos.silk`.
- `::source path "needle"` shows a real file, with paths relative to `docs/`. With a needle
  it shows the top-level item containing that text, and without one the whole file. The
  files a page may show are embedded by `src/sources.silk`.
- `::shot name "caption"` shows `dist/shots/name.png`, which `shots` drew during the build.
  Its size is listed in `src/shots.silk`.

Prefer `::source` over a fenced block for anything a reader might copy: the code then comes
from a file the compiler and the tests see.

To add a page: write the file, then add it to `src/pages.silk` (its path, title, guide and
content). To add an example: add the module under `examples/src`, export it from
`examples/silk.toml`, list it in `src/sources.silk`, and give it a test in `tests/src`.

## Checks

```sh
cd docs/tests && silk test --root src/tests.silk   # the examples behave as the pages say
silk check --workspace                             # every example app type-checks
```

## Deployment

`.github/workflows/docs.yml` builds the site on every pull request and deploys it to
Cloudflare on every push to `main`, as a Worker with static assets named `silk-ui-docs`.
It reads the organization's `CLOUDFLARE_ACCOUNT_ID` variable and `CLOUDFLARE_API_TOKEN`
secret. To put the site on a custom domain, add a `routes` entry to `wrangler.jsonc`.
