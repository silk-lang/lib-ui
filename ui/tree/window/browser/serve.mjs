// A static server for a Silk app page: index.html and app-host.js from this folder, the wasm
// module given on the command line as /app.wasm, and the window and WebGPU hosts from their
// packages.
//
//   node ui/tree/window/browser/serve.mjs APP.wasm [PORT]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repositoryRoot } from '../../../../scripts/dependency-root.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const native = repositoryRoot('lib-native');
const roots = [
  ['/ui/tree/window/browser/', here],
  ['/native/platform/window/browser/', resolve(native, 'native/platform/window/browser')],
  ['/native/gpu/webgpu/browser/', resolve(native, 'native/gpu/webgpu/browser')],
];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ts': 'text/javascript', '.wasm': 'application/wasm' };

/** Serves the page on 127.0.0.1 (port 0 picks a free one); resolves with the listening server. */
export async function serve(wasmPath, port = 0, host = '127.0.0.1') {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      let file;
      if (pathname === '/') file = resolve(here, 'index.html');
      else if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      else if (pathname === '/app.wasm') {
        // Read on each request, so a rebuild shows on reload.
        response.writeHead(200, { 'content-type': types['.wasm'], 'cache-control': 'no-store' });
        response.end(await readFile(wasmPath));
        return;
      } else {
        for (const [prefix, root] of roots) {
          if (!pathname.startsWith(prefix)) continue;
          const candidate = resolve(root, pathname.slice(prefix.length));
          if (candidate.startsWith(root + sep) && ['.js', '.ts'].includes(extname(candidate))) file = candidate;
        }
      }
      if (!file) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type': types[extname(file)], 'cache-control': 'no-store' });
      response.end(await readFile(file));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  const listening = Promise.withResolvers();
  server.once('error', listening.reject);
  server.listen(port, host, listening.resolve);
  await listening.promise;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [wasm, port] = process.argv.slice(2);
  if (!wasm) throw new Error('Usage: node ui/tree/window/browser/serve.mjs APP.wasm [PORT]');
  const server = await serve(resolve(wasm), Number(port ?? 8050));
  console.log(`The app is at http://127.0.0.1:${server.address().port}/ (Chrome or Edge 137+; Ctrl+C stops)`);
}
