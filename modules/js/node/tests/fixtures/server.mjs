// The other end of the network check: an HTTP server and a WebSocket echo on 127.0.0.1.
// Prints the port it listens on, then serves until stdin closes.
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const server = createServer((request, response) => {
  if (request.url === "/json") {
    response.setHeader("content-type", "application/json");
    response.setHeader("set-cookie", "session=abc; Path=/");
    response.end(JSON.stringify({ hello: "silk", cookie: request.headers.cookie ?? null }));
    return;
  }
  if (request.url === "/echo" && request.method === "POST") {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => response.end(Buffer.concat(chunks)));
    return;
  }
  if (request.url === "/stream") {
    response.write("one,");
    setTimeout(() => { response.write("two,"); setTimeout(() => response.end("three"), 20); }, 20);
    return;
  }
  response.statusCode = 404;
  response.end("missing");
});

// A WebSocket echo, by hand: text and binary frames come back as they were sent.
server.on("upgrade", (request, socket) => {
  const accept = createHash("sha1").update(request.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let buffered = Buffer.alloc(0);
  socket.on("data", (data) => {
    buffered = Buffer.concat([buffered, data]);
    while (buffered.length >= 2) {
      const opcode = buffered[0] & 15;
      let length = buffered[1] & 127;
      let at = 2;
      if (length === 126) { length = buffered.readUInt16BE(2); at = 4; }
      else if (length === 127) { length = Number(buffered.readBigUInt64BE(2)); at = 10; }
      if (buffered.length < at + 4 + length) return;
      const mask = buffered.subarray(at, at + 4);
      const payload = Buffer.from(buffered.subarray(at + 4, at + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buffered = buffered.subarray(at + 4 + length);
      if (opcode === 8) { socket.end(Buffer.from([0x88, 2, 0x03, 0xe8])); return; }
      const head = payload.length < 126 ? Buffer.from([0x80 | opcode, payload.length]) : Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 255]);
      socket.write(Buffer.concat([head, payload]));
    }
  });
});

server.listen(0, "127.0.0.1", () => {
  console.log(server.address().port);
});
process.stdin.on("end", () => server.close(() => process.exit(0)));
process.stdin.resume();
