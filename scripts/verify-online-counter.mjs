#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "workers/online-counter/package.json"));
const temp = await mkdtemp(join(tmpdir(), "online-verify-"));
const server = createServer().listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const base = `http://127.0.0.1:${port}`;
const sockets = [];
let log = "";
await writeFile(join(temp, "wrangler.json"), JSON.stringify({
  name: "online-isolated", main: join(root, "workers/online-counter/src/index.ts"),
  compatibility_date: "2026-09-08", compatibility_flags: ["nodejs_compat"],
  vars: { ALLOWED_ORIGINS: "https://lyjw.me" },
  durable_objects: { bindings: [{ name: "ONLINE_COUNTER", class_name: "OnlineCounterRoom" }] },
  migrations: [{ tag: "v1", new_sqlite_classes: ["OnlineCounterRoom"] }],
}));
// ws supports custom Origin, unlike the Node global WebSocket.
const { WebSocket } = createRequire(require.resolve("wrangler/package.json"))("ws");
const child = spawn(process.execPath, [require.resolve("wrangler"), "dev", "--config", join(temp, "wrangler.json"), "--port", String(port), "--persist-to", join(temp, "state")], { stdio: ["ignore", "pipe", "pipe"] });
for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { log += data; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check) {
  let error;
  for (let i = 0; i < 200; i++) {
    try { return await check(); } catch (e) { error = e; }
    await sleep(100);
  }
  throw error;
}
async function count(n) {
  const response = await fetch(`${base}/count`);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, online: n });
}
try {
  await eventually(() => count(0));
  assert.equal((await fetch(`${base}/ws`)).status, 403);
  assert.equal((await fetch(`${base}/ws`, { headers: { Origin: "https://lyjw.me" } })).status, 426);
  assert.equal((await fetch(`${base}/missing`)).status, 404);
  assert.equal((await fetch(`${base}/count`, { method: "POST" })).status, 405);
  const messages = [];
  for (let i = 1; i <= 2; i++) {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/ws", { origin: "https://lyjw.me" });
    sockets.push(ws);
    ws.on("message", data => messages.push(String(data)));
    await once(ws, "open");
    await eventually(() => count(i));
    await eventually(() => assert.ok(messages.includes(JSON.stringify({ online: i }))));
  }
  sockets[0].send("ping");
  await eventually(() => assert.ok(messages.includes("pong")));
  sockets[1].close();
  await eventually(() => count(1));
  sockets[0].close();
  await eventually(() => count(0));
  console.log("PASS: standalone count 0→1→2→1→0, broadcasts, ping/pong, origin and method checks");
} catch (error) { console.error(log); throw error; }
finally {
  for (const ws of sockets) ws.close();
  child.kill("SIGTERM");
  await once(child, "exit");
  await rm(temp, { recursive: true, force: true });
}
