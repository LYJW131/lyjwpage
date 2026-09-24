// 本地预览：node serve.mjs <目录> [端口=4817]
// 支持 Range 请求：拖进度、换配乐后跳回原位置都靠它；只监听本机回环地址
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const [dir, port = "4817"] = process.argv.slice(2);
const root = path.resolve(dir);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mp3": "audio/mpeg",
  ".woff2": "font/woff2", ".json": "application/json", ".png": "image/png", ".md": "text/plain; charset=utf-8",
};

function handler(req, res) {
  let p;
  try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400).end(); return; }
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(root, p);
  if (!f.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { "Content-Type": "text/plain" }).end("not found"); return; }
    const headers = { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (m && (m[1] !== "" || m[2] !== "")) {
      const a = m[1] === "" ? Math.max(0, st.size - +m[2]) : +m[1];
      const b = m[1] === "" || m[2] === "" ? st.size - 1 : Math.min(+m[2], st.size - 1);
      if (a > b || a >= st.size) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }).end(); return; }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${a}-${b}/${st.size}`, "Content-Length": b - a + 1 });
      if (req.method === "HEAD") { res.end(); return; }
      fs.createReadStream(f, { start: a, end: b }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, "Content-Length": st.size });
      if (req.method === "HEAD") { res.end(); return; }
      fs.createReadStream(f).pipe(res);
    }
  });
}

http.createServer(handler).listen(+port, "127.0.0.1", () => console.log(`serving ${root} at http://localhost:${port}/`));
http.createServer(handler).on("error", () => {}).listen(+port, "::1");
