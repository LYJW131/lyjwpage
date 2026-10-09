import assert from "node:assert/strict";
import test from "node:test";

import { handleBuildFire } from "@api/build-routine";
import type { Env } from "@api/runtime";
import { runIdFromBranch } from "@shared/build-routine";

const CONFIGURED = {
  ROUTINE_FIRE_URL: "https://api.anthropic.com/v1/claude_code/routines/trig_test/fire",
  ROUTINE_FIRE_TOKEN: "sk-ant-oat01-test",
} as Env;

function post(body: unknown): Request {
  return new Request("https://api.example/api/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withFetch<T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("没配令牌的 Worker 上端点当不存在", async () => {
  const response = await handleBuildFire(post({ request: "x" }), {} as Env);
  assert.equal(response.status, 404);
});

test("空需求不触发 routine", async () => {
  let called = false;
  const response = await withFetch(async () => {
    called = true;
    return Response.json({});
  }, () => handleBuildFire(post({ request: "   " }), CONFIGURED));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("触发时把 runId 与需求包成 fire text，回传会话链接和分支", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const response = await withFetch(async (input, init) => {
    seen = { url: String(input), init: init ?? {} };
    return Response.json({ type: "routine_fire", claude_code_session_url: "https://claude.ai/code/session_x" });
  }, () => handleBuildFire(post({ request: " Underline footer links " }), CONFIGURED));

  assert.equal(response.status, 200);
  const result = (await response.json()) as { runId: string; branch: string; sessionUrl: string };
  assert.equal(result.sessionUrl, "https://claude.ai/code/session_x");
  assert.equal(runIdFromBranch(result.branch), result.runId);

  assert.ok(seen);
  const { url, init } = seen as { url: string; init: RequestInit };
  assert.equal(url, CONFIGURED.ROUTINE_FIRE_URL);
  const headers = new Headers(init.headers);
  assert.equal(headers.get("Authorization"), `Bearer ${CONFIGURED.ROUTINE_FIRE_TOKEN}`);
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
  const { text } = JSON.parse(String(init.body)) as { text: string };
  assert.deepEqual(JSON.parse(text), { runId: result.runId, request: "Underline footer links" });
});

test("routine 拒绝时把上游的错误原因带回页面", async () => {
  const response = await withFetch(
    async () => Response.json({ type: "error", error: { type: "rate_limit_error", message: "Fire limit reached" } }, { status: 429 }),
    () => handleBuildFire(post({ request: "x" }), CONFIGURED),
  );
  assert.equal(response.status, 502);
  assert.match(((await response.json()) as { error: string }).error, /Fire limit reached/);
});
