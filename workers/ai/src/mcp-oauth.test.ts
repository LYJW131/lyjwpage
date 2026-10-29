import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type { PrivateHistoryQuery } from "@shared/private-history";

import type { Env } from "./runtime.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return { url: "data:text/javascript,export class DurableObject{};export class RpcTarget{};export class WorkerEntrypoint{}", shortCircuit: true };
  },
});
const { default: worker } = await import("./worker.ts");

const SITE = "https://lyjw.me";
const CLIENT_REDIRECT = "https://client.test/callback";

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string, options?: { type?: string } | string) {
      const value = store.get(key) ?? null;
      const type = typeof options === "string" ? options : options?.type;
      return value !== null && type === "json" ? JSON.parse(value) : value;
    },
    async put(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list(options?: { prefix?: string }) {
      const keys = [...store.keys()].filter((key) => key.startsWith(options?.prefix ?? "")).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

// Service Binding 的 RPC 存根把属性访问都当远端方法：readHistory.bind 也会被发去 core，core 没有这个方法就抛错。
function rpcStub<T extends object>(target: T): T {
  return new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key);
      if (typeof value !== "function") return value;
      return new Proxy(value, {
        get(fn, inner) {
          if (inner === "bind" || inner === "call" || inner === "apply") {
            throw new TypeError(`The RPC receiver does not implement the method "${String(inner)}".`);
          }
          return Reflect.get(fn, inner);
        },
      });
    },
  });
}

function oauthEnv(queries: PrivateHistoryQuery[] = []): Env {
  return {
    PUBLIC_STATUS: { readStatus: async () => Response.json({ ok: true, data: {} }) },
    ALLOWED_ORIGINS: SITE,
    OAUTH_KV: memoryKv(),
    GITHUB_APP_CLIENT_SECRET: "test-secret",
    PRIVATE_HISTORY: rpcStub({
      readHistory: async (query: PrivateHistoryQuery) => {
        queries.push(query);
        return { ok: true as const, rows: [{ started_at: Date.parse("2026-10-27T12:00:00Z"), title: "Song" }], truncated: false };
      },
    }),
  };
}

// 浏览器那一侧：同意页与 GitHub 回调靠 cookie 认出同一个浏览器。
class Browser {
  #cookies = new Map<string, string>();

  async fetch(env: Env, url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.#cookies.size) headers.set("Cookie", [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await worker.fetch(new Request(url, { ...init, headers, redirect: "manual" }), env);
    for (const cookie of (response.headers as Headers & { getSetCookie(): string[] }).getSetCookie()) {
      const [pair] = cookie.split(";");
      const at = pair.indexOf("=");
      this.#cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  }
}

async function pkce() {
  const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}

function githubStub(userId: number): typeof fetch {
  return async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "gho_test" });
    if (url === "https://api.github.com/user") return Response.json({ id: userId, login: "someone", name: null });
    if (url.startsWith("https://api.github.com/applications/")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected fetch ${url}`);
  };
}

async function signIn(env: Env, githubUserId: number, resource = `${SITE}/mcp`): Promise<{ redirect: URL; verifier: string; clientId: string }> {
  const browser = new Browser();
  const registered = await worker.fetch(new Request(`${SITE}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [CLIENT_REDIRECT], client_name: "Test client", token_endpoint_auth_method: "none" }),
  }), env);
  assert.equal(registered.status, 201);
  const { client_id: clientId } = await registered.json() as { client_id: string };

  const { verifier, challenge } = await pkce();
  const authorize = new URL(`${SITE}/oauth/authorize`);
  for (const [key, value] of Object.entries({
    response_type: "code", client_id: clientId, redirect_uri: CLIENT_REDIRECT, scope: "history:read", state: "client-state",
    code_challenge: challenge, code_challenge_method: "S256", resource,
  })) authorize.searchParams.set(key, value);
  const consent = await browser.fetch(env, authorize.href);
  assert.equal(consent.status, 200);
  const page = await consent.text();
  assert.match(page, /Allow Test client to read private history\?/);
  assert.match(page, /Self-registered; this name is not verified/);
  const handle = /name="handle" value="([^"]+)"/.exec(page)?.[1];
  assert.ok(handle);

  const approved = await browser.fetch(env, `${SITE}/oauth/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: SITE },
    body: new URLSearchParams({ handle: handle.replaceAll("&amp;", "&"), decision: "approve" }),
  });
  assert.equal(approved.status, 302);
  const github = new URL(approved.headers.get("Location") ?? "");
  assert.equal(github.origin + github.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(github.searchParams.get("redirect_uri"), `${SITE}/oauth/github/callback`);
  assert.equal(github.searchParams.get("code_challenge_method"), "S256");

  const realFetch = globalThis.fetch;
  globalThis.fetch = githubStub(githubUserId);
  try {
    const callback = await browser.fetch(env, `${SITE}/oauth/github/callback?code=github-code&state=${encodeURIComponent(github.searchParams.get("state") ?? "")}`);
    assert.equal(callback.status, 302);
    return { redirect: new URL(callback.headers.get("Location") ?? ""), verifier, clientId };
  } finally {
    globalThis.fetch = realFetch;
  }
}

function mcpCall(token: string | null, name: string, args: object = {}, url = `${SITE}/mcp`) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18", ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
}

test("发现：资源元数据与授权服务器元数据指向本站，匿名调私有工具回 401 登录挑战", async () => {
  const env = oauthEnv();
  const resource = await worker.fetch(new Request(`${SITE}/.well-known/oauth-protected-resource/mcp`), env);
  assert.equal(resource.status, 200);
  const metadata = await resource.json() as { resource: string; authorization_servers: string[]; scopes_supported: string[] };
  assert.equal(metadata.resource, `${SITE}/mcp`);
  assert.deepEqual(metadata.authorization_servers, [SITE]);
  assert.deepEqual(metadata.scopes_supported, ["history:read"]);

  const server = await worker.fetch(new Request(`${SITE}/.well-known/oauth-authorization-server`), env);
  const as = await server.json() as Record<string, unknown>;
  assert.equal(as.issuer, SITE);
  assert.equal(as.authorization_endpoint, `${SITE}/oauth/authorize`);
  assert.equal(as.token_endpoint, `${SITE}/oauth/token`);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);

  const anonymous = await worker.fetch(mcpCall(null, "read_private_history", { table: "workouts" }), env);
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("WWW-Authenticate") ?? "", /resource_metadata="https:\/\/lyjw\.me\/\.well-known\/oauth-protected-resource\/mcp"/);

  const publicRead = await worker.fetch(mcpCall(null, "get_site_status", { views: ["timezone"] }), env);
  assert.equal(publicRead.status, 200, "公开工具照旧不用登录");

  const badToken = await worker.fetch(mcpCall("not-a-token", "get_site_status", { views: ["timezone"] }), env);
  assert.equal(badToken.status, 401, "带了无效令牌就按令牌失效处理，客户端去刷新或重新登录");
});

test("lyjw 的 GitHub 账号走完授权拿到令牌，带令牌读私有历史", async () => {
  const queries: PrivateHistoryQuery[] = [];
  const env = oauthEnv(queries);
  const { redirect, verifier, clientId } = await signIn(env, 153256373);
  assert.equal(redirect.origin + redirect.pathname, CLIENT_REDIRECT);
  assert.equal(redirect.searchParams.get("state"), "client-state");
  assert.equal(redirect.searchParams.get("iss"), SITE);
  const code = redirect.searchParams.get("code");
  assert.ok(code);

  const tokenResponse = await worker.fetch(new Request(`${SITE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CLIENT_REDIRECT, client_id: clientId, code_verifier: verifier, resource: `${SITE}/mcp` }),
  }), env);
  assert.equal(tokenResponse.status, 200);
  const { access_token: token, scope } = await tokenResponse.json() as { access_token: string; scope: string };
  assert.equal(scope, "history:read");

  const response = await worker.fetch(mcpCall(token, "read_private_history", { table: "listening_plays", from: "2026-10-27", to: "2026-10-28", limit: 5 }), env);
  assert.equal(response.status, 200);
  const body = await response.json() as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(body.result.isError, false);
  assert.match(body.result.content[0].text, /"startedAt":"2026-10-27 20:00 \(/);
  assert.deepEqual(queries, [{ table: "listening_plays", from: Date.parse("2026-10-26T16:00:00Z"), to: Date.parse("2026-10-27T16:00:00Z"), limit: 5 }]);
});

test("客户端拿 /mcp?codemode=on 当 resource 登录，令牌受众归到 /mcp，带令牌在同一地址照常用", async () => {
  const env = { ...oauthEnv(), LOADER: { load: () => ({ getEntrypoint: () => ({ run: async () => JSON.stringify({ ok: true, result: 1 }) }) }) } as unknown as WorkerLoader };
  const codeModeUrl = `${SITE}/mcp?codemode=on`;
  const { redirect, verifier, clientId } = await signIn(env, 153256373, codeModeUrl);
  const code = redirect.searchParams.get("code");
  assert.ok(code);
  const tokenResponse = await worker.fetch(new Request(`${SITE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: CLIENT_REDIRECT, client_id: clientId, code_verifier: verifier, resource: codeModeUrl }),
  }), env);
  assert.equal(tokenResponse.status, 200);
  const { access_token: token } = await tokenResponse.json() as { access_token: string };

  const run = await worker.fetch(mcpCall(token, "run_site_code", { code: "return 1;" }, codeModeUrl), env);
  assert.equal(run.status, 200);
  assert.equal((await run.json() as { result: { content: { text: string }[] } }).result.content[0].text, "1");
  const history = await worker.fetch(mcpCall(token, "read_private_history", { table: "listening_plays", from: "2026-10-27", to: "2026-10-28", limit: 5 }, codeModeUrl), env);
  assert.equal((await history.json() as { result: { isError: boolean } }).result.isError, false);
});

test("别的 GitHub 账号在回调处被拒，客户端拿到 access_denied 而不是授权码", async () => {
  const { redirect } = await signIn(oauthEnv(), 1);
  assert.equal(redirect.searchParams.get("error"), "access_denied");
  assert.equal(redirect.searchParams.get("code"), null);
});

test("没绑 OAUTH_KV 时登录端点与带令牌的 /mcp 关闭，匿名 /mcp 照旧", async () => {
  const env = { ...oauthEnv(), OAUTH_KV: undefined };
  assert.equal((await worker.fetch(new Request(`${SITE}/oauth/authorize`), env)).status, 503);
  assert.equal((await worker.fetch(mcpCall("token", "get_site_status", { views: ["timezone"] }), env)).status, 503);
  assert.equal((await worker.fetch(mcpCall(null, "get_site_status", { views: ["timezone"] }), env)).status, 200);
});
