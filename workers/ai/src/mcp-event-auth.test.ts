import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { authenticateEventPrincipal, eventCallbackHosts, eventPrincipalAllowed, eventsConfigured } from "./mcp-event-auth.ts";

const token = "synthetic-event-auth-token-000000001";
const client = { principal: "client-a", tokenSha256: createHash("sha256").update(token).digest("hex") };
const env = { MCP_EVENT_CLIENTS: JSON.stringify([client]), MCP_EVENT_CALLBACK_HOSTS: "callback.example.com" };
const request = (authorization?: string) => new Request("https://api.test/mcp", { headers: authorization ? { Authorization: authorization } : {} });

test("events are disabled without both clients and exact callback hosts", () => {
  assert.equal(eventsConfigured({}), false);
  assert.equal(eventsConfigured({ ...env, MCP_EVENT_CALLBACK_HOSTS: "" }), false);
  assert.equal(eventsConfigured({ ...env, MCP_EVENT_CLIENTS: "{}" }), false);
  assert.equal(eventsConfigured(env), true);
  assert.deepEqual(eventCallbackHosts({ MCP_EVENT_CALLBACK_HOSTS: "callback.example.com, callback.example.com" }), ["callback.example.com"]);
  for (const host of ["*.example.com", "https://callback.example.com", "callback.example.com/path", "callback.example.com:443", "127.0.0.1", "localhost"]) {
    assert.equal(eventsConfigured({ ...env, MCP_EVENT_CALLBACK_HOSTS: host }), false, host);
  }
});

test("bearer hashes resolve stable configured principals without accepting caller identity", async () => {
  assert.equal(await authenticateEventPrincipal(request(`Bearer ${token}`), env), "client-a");
  for (const authorization of [undefined, "Bearer short", `Basic ${token}`, `Bearer ${token}-wrong`]) {
    assert.equal(await authenticateEventPrincipal(request(authorization), env), null);
  }
  assert.equal(eventPrincipalAllowed("client-a", env), true);
  assert.equal(eventPrincipalAllowed("client-b", env), false);
  assert.equal(eventPrincipalAllowed("client-a", { ...env, MCP_EVENT_CLIENTS: "[]" }), false);
});

test("invalid or ambiguous auth configuration fails closed", async () => {
  for (const clients of ["invalid", JSON.stringify([client, client]), JSON.stringify([{ ...client, tokenSha256: "not-a-hash" }]), JSON.stringify([{ ...client, extra: "secret" }]), JSON.stringify([{ ...client, principal: "../owner" }]), JSON.stringify([client, { ...client, principal: "client-b" }])]) {
    assert.equal(eventsConfigured({ ...env, MCP_EVENT_CLIENTS: clients }), false);
    assert.equal(await authenticateEventPrincipal(request(`Bearer ${token}`), { ...env, MCP_EVENT_CLIENTS: clients }), null);
  }
});
