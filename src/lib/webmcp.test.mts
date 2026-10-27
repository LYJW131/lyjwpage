import assert from "node:assert/strict";
import test from "node:test";

import { STATUS_VIEWS } from "@shared/status-views";

import { registerSiteTools, siteTools, type ModelContextTool } from "./webmcp.ts";

process.env.PUBLIC_BACKEND_URL = "https://lyjw.me";

const statusTool = () => siteTools().find((tool) => tool.name === "get_site_status")!;

test("registers every site tool with the caller's signal so unmount unregisters them", async () => {
  const registered: { tool: ModelContextTool; signal?: AbortSignal }[] = [];
  const controller = new AbortController();
  await registerSiteTools({ registerTool: async (tool, options) => void registered.push({ tool, signal: options?.signal }) }, controller.signal);
  assert.deepEqual(registered.map(({ tool }) => tool.name), ["get_site_status"]);
  assert.ok(registered.every(({ signal }) => signal === controller.signal));
});

test("get_site_status reads the view's public endpoint and returns its JSON text", async (t) => {
  const seen: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    seen.push(url);
    return new Response('{"ok":true,"data":{}}');
  });
  const text = await statusTool().execute({ view: "nowListening" }, { signal: new AbortController().signal });
  assert.equal(text, '{"ok":true,"data":{}}');
  assert.ok(seen[0].endsWith(STATUS_VIEWS.nowListening.path), seen[0]);
});

test("get_site_status rejects unknown views and failed reads with a message the agent can act on", async (t) => {
  const signal = new AbortController().signal;
  await assert.rejects(statusTool().execute({ view: "secrets" }, { signal }), /Use one of: desktop/);
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 503 }));
  await assert.rejects(statusTool().execute({ view: "server" }, { signal }), /HTTP 503/);
});

test("get_site_status truncates oversized views", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("x".repeat(30_000)));
  const text = String(await statusTool().execute({ view: "codingYear" }, { signal: new AbortController().signal }));
  assert.match(text, /\[truncated: view is 30000 chars\]$/);
  assert.ok(text.length < 21_000);
});
