// The realm side of the network check: web APIs from the runtime, against fixtures/server.mjs
// at process.env.SILK_TEST_PORT. Exits 0 when every check passed, 1 with the failure printed.
import { createBox, mount } from "@silk/ui";

const base = `http://127.0.0.1:${process.env.SILK_TEST_PORT}`;
const check = (condition, what) => { if (!condition) throw new Error("failed: " + what); };

async function main() {
  // @silk/ui and __ui reach the tree from the runtime's realm.
  mount(createBox());
  check(new TextDecoder().decode(new TextEncoder().encode("héllo")) === "héllo", "TextEncoder");
  check(new URL("/a?b=1", base).searchParams.get("b") === "1", "URL");
  check(typeof crypto.randomUUID() === "string" && crypto.getRandomValues(new Uint8Array(4)).length === 4, "crypto");
  check(new Intl.NumberFormat("en-US").format(1234.5) === "1,234.5", "Intl");
  check(structuredClone(new Map([[1, 2]])).get(1) === 2, "structuredClone");

  const json = await (await fetch(base + "/json")).json();
  check(json.hello === "silk", "fetch json");
  const echoed = await (await fetch(base + "/echo", { method: "POST", body: new Uint8Array([1, 2, 3]) })).arrayBuffer();
  check(new Uint8Array(echoed).join() === "1,2,3", "fetch body");
  const reader = (await fetch(base + "/stream")).body.getReader();
  let streamed = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) streamed += new TextDecoder().decode(chunk.value);
  check(streamed === "one,two,three", "streamed body: " + streamed);
  const controller = new AbortController();
  const aborted = fetch(base + "/stream", { signal: controller.signal });
  controller.abort();
  check(await aborted.then(() => false, (error) => error.name === "AbortError"), "abort");

  const socket = new WebSocket(base.replace("http", "ws") + "/socket");
  socket.binaryType = "arraybuffer";
  const messages = [];
  await new Promise((resolve, reject) => {
    socket.onopen = () => { socket.send("text"); socket.send(new Uint8Array([7, 8])); };
    socket.onmessage = (event) => { messages.push(event.data); if (messages.length === 2) socket.close(1000, "done"); };
    socket.onclose = resolve;
    socket.onerror = () => reject(new Error("socket error"));
  });
  check(messages[0] === "text" && new Uint8Array(messages[1]).join() === "7,8", "WebSocket echo");

  let ticked = false;
  await new Promise((resolve) => setTimeout(() => { ticked = true; resolve(); }, 10));
  check(ticked, "timers");
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
