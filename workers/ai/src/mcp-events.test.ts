import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { registerHooks } from "node:module";
import test from "node:test";

import { handleMcp, type McpEventAccess } from "./mcp.ts";
import type { Env } from "./runtime.ts";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return { url: "data:text/javascript,export class DurableObject{}", shortCircuit: true };
  },
});
const { default: worker } = await import("./worker.ts");

type RpcBody = {
  result: { id: string; resultType: string; cacheScope: string; capabilities: unknown; events: { name: string; delivery: string[] }[]; tools: unknown[] };
  error: { code: number; message: string; data?: unknown };
};

const version = "2026-07-28";
const io = { readStatus: async () => Response.json({ ok: true }), readDoc: async () => new Response("public") };
const calls: unknown[] = [];
const access: McpEventAccess = {
  principal: "alice",
  subscribe: async (principal, params) => { calls.push({ principal, params }); return { result: { id: "sub_test", refreshBefore: "2026-10-10T00:00:00Z", cursor: null, truncated: false } }; },
  unsubscribe: async (principal, params) => { calls.push({ principal, params }); return { result: {} }; },
};

function request(method: string, params: Record<string, unknown> = {}, legacy = false, authorization?: string) {
  return new Request("https://ai.test/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", "MCP-Protocol-Version": legacy ? "2025-03-26" : version, "Mcp-Method": method, ...(authorization && { Authorization: authorization }) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, ...(!legacy && { _meta: { "io.modelcontextprotocol/protocolVersion": version, "io.modelcontextprotocol/clientCapabilities": {} } }) } }),
  });
}
const post = async (method: string, params: Record<string, unknown> = {}, events: McpEventAccess | null = access, legacy = false) => {
  const response = await handleMcp(request(method, params, legacy), io, "test", events);
  return { response, body: await response.json() as RpcBody };
};

test("modern discovery advertises configured webhook support while the catalog requires authorization", async () => {
  assert.deepEqual((await post("server/discover")).body.result.capabilities, { tools: {}, events: {} });
  assert.deepEqual((await post("server/discover", {}, null)).body.result.capabilities, { tools: {} });
  const enabled = await handleMcp(request("server/discover"), io, "test", null, true);
  assert.deepEqual((await enabled.json() as RpcBody).result.capabilities, { tools: {}, events: {} });
  assert.equal((await post("server/discover")).body.result.cacheScope, "private");
  const listing = (await post("events/list")).body.result;
  assert.equal(listing.resultType, "complete");
  assert.equal(listing.events.length, 1);
  assert.equal(listing.events[0].name, "watching-now");
  assert.deepEqual(listing.events[0].delivery, ["webhook"]);
  assert.equal(listing.cacheScope, "private");
  assert.equal((await post("events/list", { cursor: "unknown" })).body.error.code, -32602);
  assert.equal((await post("events/list", { principal: "alice" })).body.error.code, -32602);
});

test("event methods reject anonymous access and legacy transport without affecting public tools", async () => {
  for (const method of ["events/list", "events/subscribe", "events/unsubscribe"]) {
    const anonymous = await post(method, {}, null);
    assert.equal(anonymous.response.status, 401);
    assert.equal(anonymous.body.error.code, -32012);
    assert.equal((await post(method, {}, access, true)).body.error.code, -32601);
  }
  assert.equal((await post("tools/list", {}, null)).body.result.tools.length, 2);
  for (const method of ["events/poll", "events/stream"]) {
    const unsupported = await post(method);
    assert.equal(unsupported.response.status, 404);
    assert.equal(unsupported.body.error.code, -32601);
  }
});

test("subscriptions use server-authenticated identity and retain the ChatGPT profile error code", async () => {
  const result = await post("events/subscribe", { name: "watching-now", principal: "mallory" });
  assert.equal(result.body.result.id, "sub_test");
  assert.equal((calls.at(-1) as { principal: string }).principal, "alice");
  const failed: McpEventAccess = { ...access, subscribe: async () => ({ error: { code: -32015, message: "CallbackEndpointError", data: { reason: "challenge_failed" } } }) };
  assert.deepEqual((await post("events/subscribe", {}, failed)).body.error, { code: -32015, message: "CallbackEndpointError", data: { reason: "challenge_failed" } });
  assert.equal((await post("events/unsubscribe")).body.result.resultType, "complete");
});

test("worker gates durable object access behind configured OAuth JWT authentication", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...await exportJWK(publicKey), kid: "mcp-worker-unit", alg: "RS256", use: "sig" };
  const issuer = "https://issuer.example.com";
  const resource = "https://mcp.example.com/mcp";
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  const token = await new SignJWT({ scope: "mcp:events" }).setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(issuer).setAudience(resource).setSubject("user-alice").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  let opens = 0;
  const env = {
    PUBLIC_STATUS: { readStatus: io.readStatus },
    MCP_EVENT_AUTH: JSON.stringify({ issuer, resource, jwksUrl }),
    MCP_EVENT_CLIENTS: JSON.stringify([{ principal: "alice", subject: "user-alice" }]),
    MCP_EVENT_CALLBACK_HOSTS: "callback.example.com",
    MCP_EVENTS: { idFromName: () => "test", get: () => { opens++; return access; } },
  } as unknown as Env;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), jwksUrl);
    return Response.json({ keys: [jwk] });
  }) as typeof fetch;
  try {
    const anonymous = await worker.fetch(request("events/list"), env);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get("WWW-Authenticate") ?? "", /resource_metadata=/);
    assert.equal(opens, 0);
    const invalid = await worker.fetch(request("events/list", {}, false, "Bearer invalid-synthetic-token-00000001"), env);
    assert.equal(invalid.status, 401);
    assert.equal(opens, 0);
    const authed = await worker.fetch(request("events/list", {}, false, `Bearer ${token}`), env);
    assert.equal(authed.status, 200);
    assert.equal(opens, 1);
    const revoked = await worker.fetch(request("events/subscribe", {}, false, `Bearer ${token}`), { ...env, MCP_EVENT_CLIENTS: "[]" });
    assert.equal(revoked.status, 401);
    assert.equal(opens, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
