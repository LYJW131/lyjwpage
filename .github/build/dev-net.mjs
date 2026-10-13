import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";
import tls from "node:tls";

// 沙盒的网络命名空间里没有 DNS：workerd 不认代理环境变量，只能连本机的明文中继；Chrome 丢弃代理 URL 里的凭据，只能走本机这个不鉴权的 CONNECT 代理再接沙盒代理。
const [, , proxyPortArg, ...relayArgs] = process.argv;
if (process.env.NODE_USE_ENV_PROXY !== "1") {
  console.error("dev-net: run with NODE_USE_ENV_PROXY=1");
  process.exit(2);
}
const upstream = new URL(process.env.HTTPS_PROXY ?? process.env.https_proxy ?? "");
const proxyAuth = upstream.username
  ? `Basic ${Buffer.from(`${decodeURIComponent(upstream.username)}:${decodeURIComponent(upstream.password)}`).toString("base64")}`
  : null;
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length", "content-encoding", "proxy-authorization"]);

function connectUpstream(target, onOpen) {
  const socket = net.connect(Number(upstream.port), upstream.hostname, () => {
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${proxyAuth ? `Proxy-Authorization: ${proxyAuth}\r\n` : ""}\r\n`);
    onOpen?.();
  });
  return socket;
}

function tunnel(host, onSocket, onError) {
  const socket = connectUpstream(`${host}:443`);
  let buffer = Buffer.alloc(0);
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const end = buffer.indexOf("\r\n\r\n");
    if (end === -1) return;
    socket.off("data", onData);
    const head = buffer.toString("latin1", 0, end);
    if (!/^HTTP\/1\.[01] 200/.test(head)) return onError(new Error(head));
    onSocket(socket, buffer.subarray(end + 4));
  };
  socket.on("data", onData);
  socket.on("error", onError);
}

function relay(port, origin) {
  const server = http.createServer(async (req, res) => {
    // 不用 new URL(req.url, origin)：绝对形式的请求目标（GET https://别的主机/）会换掉主机。只取路径与查询，主机固定为中继的源。
    const { pathname, search } = new URL(req.url ?? "/", "http://relay.invalid");
    const target = new URL(origin);
    target.pathname = pathname;
    target.search = search;
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) if (!HOP.has(key)) headers[key] = value;
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : Readable.toWeb(req);
    const once = () => fetch(target, { method: req.method, headers, body, duplex: "half", redirect: "manual" });
    try {
      // 沙盒代理偶尔掐断请求，首屏数据缺一个就渲染错误页；没有请求体的请求可以安全地重试一次。
      const response = await once().catch((error) => {
        if (body) throw error;
        return once();
      });
      const out = {};
      response.headers.forEach((value, key) => {
        if (!HOP.has(key)) out[key] = value;
      });
      res.writeHead(response.status, out);
      console.log(`relay ${response.status} ${target.href}`);
      if (response.body) Readable.fromWeb(response.body).pipe(res);
      else res.end();
    } catch (error) {
      console.log(`relay failed ${target.href} ${error.cause?.code ?? error.message}`);
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("dev-net relay failed");
    }
  });
  server.on("upgrade", (req, client, head) => {
    tunnel(origin.hostname, (raw, rest) => {
      if (rest.length) raw.unshift(rest);
      const secure = tls.connect({ socket: raw, servername: origin.hostname }, () => {
        const lines = [`${req.method} ${req.url} HTTP/1.1`, `Host: ${origin.host}`];
        for (let index = 0; index < req.rawHeaders.length; index += 2) {
          if (req.rawHeaders[index].toLowerCase() !== "host") lines.push(`${req.rawHeaders[index]}: ${req.rawHeaders[index + 1]}`);
        }
        secure.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (head.length) secure.write(head);
        secure.pipe(client);
        client.pipe(secure);
        console.log(`relay websocket ${origin.host}${req.url}`);
      });
      secure.on("error", () => client.destroy());
      client.on("error", () => secure.destroy());
    }, (error) => {
      console.log(`relay websocket failed ${error.message}`);
      client.destroy();
    });
  });
  server.listen(port, "127.0.0.1", () => console.log(`relay :${port} -> ${origin.origin}`));
}

for (const arg of relayArgs) {
  const [port, origin] = arg.split("=");
  relay(Number(port), new URL(origin));
}

const proxy = http.createServer((req, res) => {
  res.writeHead(405);
  res.end("CONNECT only");
});
proxy.on("connect", (req, client, head) => {
  const socket = connectUpstream(req.url, () => {
    if (head.length) socket.write(head);
    client.pipe(socket);
    socket.pipe(client);
    console.log(`proxy CONNECT ${req.url}`);
  });
  socket.on("error", () => client.destroy());
  client.on("error", () => socket.destroy());
});
proxy.listen(Number(proxyPortArg), "127.0.0.1", () => console.log(`proxy :${proxyPortArg} -> ${upstream.host}`));
