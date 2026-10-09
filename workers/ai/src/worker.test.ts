import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type { Env } from "./runtime.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return { url: "data:text/javascript,export class DurableObject{}", shortCircuit: true };
  },
});
const { default: worker } = await import("./worker.ts");
const { sentryOptions } = await import("./sentry.ts");

const env = (overrides: Partial<Env> = {}): Env => ({
  PUBLIC_STATUS: { readStatus: async () => { throw new Error("Unexpected status read"); } },
  ALLOWED_ORIGINS: "https://lyjw.me",
  ...overrides,
});

function request(path: string, method = "GET", origin?: string): Request {
  return new Request(`https://ai.test${path}`, { method, ...(origin && { headers: { Origin: origin } }) });
}

test("AI Worker 不公开状态、存储、推送和未知路由，包括预检请求", async () => {
  for (const path of ["/", "/api/status/timezone", "/api/internal/storage/import", "/ws", "/api/build", "/api/chat/other"]) {
    for (const method of ["GET", "POST", "OPTIONS"]) {
      assert.equal((await worker.fetch(request(path, method), env())).status, 404, `${method} ${path}`);
    }
  }
});

test("四条 AI 路由保留 CORS 预检，MCP 保留协议请求头", async () => {
  for (const path of ["/api/chat", "/api/chat/usage", "/api/github/issue", "/mcp"]) {
    const response = await worker.fetch(request(path, "OPTIONS", "https://lyjw.me"), env());
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://lyjw.me");
    if (path === "/mcp") assert.match(response.headers.get("Access-Control-Allow-Headers") ?? "", /MCP-Protocol-Version, Mcp-Method, Mcp-Name/);
  }
});

test("网页 AI 路由拒绝未授权来源，MCP 同样拒绝携带陌生 Origin 的请求", async () => {
  for (const path of ["/api/chat", "/api/chat/usage", "/api/github/issue", "/mcp"]) {
    const response = await worker.fetch(request(path, path === "/api/chat/usage" ? "GET" : "POST", "https://elsewhere.test"), env());
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  }
});

test("无 Origin 的 MCP 客户端通过只读 Service Binding 查询公开状态", async () => {
  const paths: string[] = [];
  const response = await worker.fetch(new Request("https://ai.test/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_site_status", arguments: { views: ["timezone"] } } }),
  }), env({
    PUBLIC_STATUS: { readStatus: async (path) => {
      paths.push(path);
      return Response.json({ ok: true, data: { timezone: "Asia/Singapore" } });
    } },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(paths, ["/api/status/timezone"]);
  const body = await response.json() as { result: { content: { text: string }[] } };
  assert.match(body.result.content[0].text, /Asia\/Singapore/);
});

test("MCP 按来访 IP 限流，拒绝的请求不进入状态读取", async () => {
  const keys: string[] = [];
  const response = await worker.fetch(new Request("https://ai.test/mcp", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.1" },
    body: "{}",
  }), env({ MCP_LIMIT: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.deepEqual(keys, ["192.0.2.1"]);
});

test("额度查询仍只收 GET，缺计数绑定时关闭入口且响应不可缓存", async () => {
  assert.equal((await worker.fetch(request("/api/chat/usage", "POST", "https://lyjw.me"), env())).status, 405);
  const response = await worker.fetch(request("/api/chat/usage", "GET", "https://lyjw.me"), env());
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("Sentry 默认标为 production，只有显式预览开关或环境设置才改变", () => {
  assert.equal(sentryOptions(env()).environment, "production");
  assert.equal(sentryOptions(env({ PREVIEW_WORKER: "true" })).environment, "preview");
  assert.equal(sentryOptions(env({ SENTRY_ENVIRONMENT: "development" })).environment, "development");
  assert.equal(sentryOptions(env()).sendDefaultPii, false);
});
