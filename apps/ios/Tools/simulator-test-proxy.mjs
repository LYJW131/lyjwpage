import http from "node:http";

const server = http.createServer((request, response) => {
  if (request.url?.startsWith("/api/lyrics?")) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      songId: "1490256995",
      lines: [
        { startMs: 0, endMs: 18000, text: "Fixture first line" },
        { startMs: 18000, endMs: 261013, text: "Fixture second line" },
      ],
    }));
    return;
  }
  const upstream = http.request({ hostname: "localhost", port: 8788, path: request.url, method: request.method, headers: request.headers }, (incoming) => {
    response.writeHead(incoming.statusCode, incoming.headers);
    incoming.pipe(response);
  });
  upstream.on("error", () => {
    response.writeHead(502);
    response.end("Local Worker unavailable");
  });
  request.pipe(upstream);
});

server.on("upgrade", (request, socket, head) => {
  const upstream = http.request({ hostname: "localhost", port: 8788, path: request.url, headers: request.headers });
  upstream.on("upgrade", (incoming, remote, remoteHead) => {
    socket.write(`HTTP/1.1 ${incoming.statusCode} Switching Protocols\r\n`);
    for (const [key, value] of Object.entries(incoming.headers)) socket.write(`${key}: ${value}\r\n`);
    socket.write("\r\n");
    if (head.length) remote.write(head);
    if (remoteHead.length) socket.write(remoteHead);
    socket.pipe(remote).pipe(socket);
    socket.on("error", () => remote.destroy());
    remote.on("error", () => socket.destroy());
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});

server.listen(8790, "localhost", () => process.stdout.write("Simulator test proxy: http://localhost:8790\n"));
