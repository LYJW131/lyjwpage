import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { MCP_RESOURCE_METADATA_PATH, MCP_RESOURCE_METADATA_ROOT_PATH } from "@shared/ai-paths";

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

const oauthConfig = { issuer: "https://issuer.example.com", resource: "https://api.example.com/mcp", jwksUrl: "https://issuer.example.com/jwks" };
const metadataPaths = [MCP_RESOURCE_METADATA_PATH, MCP_RESOURCE_METADATA_ROOT_PATH];
const eventEnv = (): Env => env({
  MCP_EVENT_AUTH: JSON.stringify(oauthConfig),
  MCP_EVENT_CLIENTS: JSON.stringify([{ principal: "client-a", subject: "account-a" }]),
  MCP_EVENT_CALLBACK_HOSTS: "callback.example.com",
  MCP_EVENTS: {
    idFromName: () => ({}),
    get: () => ({ subscribe: async () => { throw new Error("Unexpected subscription"); } }),
  } as unknown as Env["MCP_EVENTS"],
});

function modernRequest(method: string, token?: string, params: Record<string, unknown> = {}): Request {
  return new Request("https://ai.test/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    } } }),
  });
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

test("OAuth resource metadata is public on canonical and root paths with no-store CORS", async () => {
  for (const path of metadataPaths) {
    const response = await worker.fetch(request(path, "GET", "https://client.example.com"), eventEnv());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    const metadata = await response.json() as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
    assert.equal(metadata.resource, oauthConfig.resource);
    assert.deepEqual(metadata.authorization_servers, [oauthConfig.issuer]);
    assert.deepEqual(metadata.scopes_supported, ["mcp:events"]);
    const preflight = await worker.fetch(request(path, "OPTIONS", "https://client.example.com"), eventEnv());
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
    assert.equal(preflight.headers.get("Cache-Control"), "no-store");
    const post = await worker.fetch(request(path, "POST"), eventEnv());
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("Allow"), "GET, OPTIONS");
  }
});

test("unconfigured resource metadata stays closed for reads and preflight", async () => {
  for (const path of metadataPaths) {
    for (const method of ["GET", "OPTIONS", "POST"]) {
      const response = await worker.fetch(request(path, method), env());
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  }
  assert.equal((await worker.fetch(request(`${MCP_RESOURCE_METADATA_PATH}/other`), eventEnv())).status, 404);
});

test("event authentication failures carry canonical OAuth challenges without closing public tools", async () => {
  for (const token of [undefined, "invalid-token"]) {
    const response = await worker.fetch(modernRequest("events/list", token), eventEnv());
    assert.equal(response.status, 401);
    const challenge = response.headers.get("WWW-Authenticate") ?? "";
    assert.match(challenge, /^Bearer /);
    assert.ok(challenge.includes(`resource_metadata="https://api.example.com${MCP_RESOURCE_METADATA_PATH}"`));
    assert.ok(challenge.includes('scope="mcp:events"'));
    assert.equal(challenge.includes('error="invalid_token"'), token !== undefined);
    assert.equal(response.headers.get("Access-Control-Expose-Headers"), "WWW-Authenticate");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const tools = await worker.fetch(modernRequest("tools/list", token), eventEnv());
    assert.equal(tools.status, 200);
    assert.equal(tools.headers.get("WWW-Authenticate"), null);
  }
});

test("configured event capability is public while the event catalog still requires authorization", async () => {
  for (const [configuration, expected] of [
    [eventEnv(), { tools: {}, events: {} }],
    [env(), { tools: {} }],
    [{ ...eventEnv(), MCP_EVENTS: undefined }, { tools: {} }],
  ] as const) {
    const response = await worker.fetch(modernRequest("server/discover"), configuration);
    assert.equal(response.status, 200);
    const body = await response.json() as { result: { capabilities: unknown } };
    assert.deepEqual(body.result.capabilities, expected);
  }
});

test("a verified token without event scope receives 403 while a scoped token exposes events", async (t) => {
  const key = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = await crypto.subtle.exportKey("jwk", key.publicKey);
  t.mock.method(globalThis, "fetch", async (input: Request | URL | string) => {
    assert.equal(input instanceof Request ? input.url : String(input), oauthConfig.jwksUrl);
    return Response.json({ keys: [{ ...publicKey, kid: "worker-test", use: "sig", alg: "RS256" }] });
  });
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  async function token(scope: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const data = `${encode({ alg: "RS256", typ: "at+jwt", kid: "worker-test" })}.${encode({ iss: oauthConfig.issuer, aud: oauthConfig.resource, sub: "account-a", iat: now, exp: now + 300, scope })}`;
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(data));
    return `${data}.${Buffer.from(signature).toString("base64url")}`;
  }
  const denied = await worker.fetch(modernRequest("events/list", await token("other:scope")), eventEnv());
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get("WWW-Authenticate") ?? "", /error="insufficient_scope"/);
  const accessToken = await token("mcp:events");
  const allowed = await worker.fetch(modernRequest("events/list", accessToken), eventEnv());
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("WWW-Authenticate"), null);
  const body = await allowed.json() as { result: { events: { name: string }[] } };
  assert.deepEqual(body.result.events.map((event) => event.name), ["watching-now"]);
  const grants: unknown[][] = [];
  const withSubscriptions = eventEnv();
  withSubscriptions.MCP_EVENTS = {
    idFromName: () => ({}),
    get: () => ({ subscribe: async (...args: unknown[]) => {
      grants.push(args);
      return { result: { id: "test-subscription" } };
    } }),
  } as unknown as Env["MCP_EVENTS"];
  const subscribed = await worker.fetch(modernRequest("events/subscribe", accessToken, { name: "watching-now" }), withSubscriptions);
  assert.equal(subscribed.status, 200);
  assert.equal(grants.length, 1);
  assert.match(String(grants[0][0]), /^oauth_[a-f0-9]{64}$/);
  const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString()) as { exp: number };
  assert.equal(grants[0][2], claims.exp * 1000);
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
