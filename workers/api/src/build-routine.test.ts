import assert from "node:assert/strict";
import test from "node:test";

import { coauthorLine, handleBuildFire, handleBuildSession, readSession, signSession, type Connected } from "@api/build-routine";
import type { Env } from "@api/runtime";
import { runIdFromBranch } from "@shared/build-routine";

const CONFIGURED = {
  ROUTINE_FIRE_URL: "https://api.anthropic.com/v1/claude_code/routines/trig_test/fire",
  ROUTINE_FIRE_TOKEN: "sk-ant-oat01-test",
  BUILD_SESSION_SECRET: "session-secret",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
} as Env;

const OCTOCAT: Connected = { login: "octocat", id: 583231, name: "The Octocat", exp: Date.now() + 60_000 };

function post(body: unknown): Request {
  return new Request("https://api.example/api/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const unused: typeof fetch = async () => {
  throw new Error("不该发出请求");
};

async function withGlobalFetch<T>(stub: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("会话串能验回同一个身份，换密钥、改内容、过期都验不过", async () => {
  const token = await signSession("session-secret", OCTOCAT);
  assert.deepEqual(await readSession("session-secret", token), OCTOCAT);
  assert.equal(await readSession("other-secret", token), null);
  const [body, sig] = token.split(".");
  assert.equal(await readSession("session-secret", `${body}x.${sig}`), null);
  assert.equal(await readSession("session-secret", token, OCTOCAT.exp), null);
  assert.equal(await readSession("session-secret", undefined), null);
});

test("合著者用 noreply 地址，名字里的换行和尖括号清掉，没名字用登录名", () => {
  assert.equal(coauthorLine(OCTOCAT), "The Octocat <583231+octocat@users.noreply.github.com>");
  assert.equal(coauthorLine({ ...OCTOCAT, name: "Evil\nCo-authored-by: x <a@b>" }), "Evil Co-authored-by: x a@b <583231+octocat@users.noreply.github.com>");
  assert.equal(coauthorLine({ ...OCTOCAT, name: null }), "octocat <583231+octocat@users.noreply.github.com>");
  assert.equal(coauthorLine({ ...OCTOCAT, name: " <> " }), "octocat <583231+octocat@users.noreply.github.com>");
});

test("没配齐的 Worker 上两个端点都当不存在", async () => {
  assert.equal((await handleBuildFire(post({ request: "x" }), {} as Env, unused)).status, 404);
  assert.equal((await handleBuildSession(post({ code: "abc" }), { ...CONFIGURED, BUILD_SESSION_SECRET: undefined } as Env)).status, 404);
});

test("没连 GitHub 或会话失效不触发 routine", async () => {
  assert.equal((await handleBuildFire(post({ request: "x" }), CONFIGURED, unused)).status, 401);
  const expired = await signSession("session-secret", { ...OCTOCAT, exp: Date.now() - 1 });
  assert.equal((await handleBuildFire(post({ request: "x", session: expired }), CONFIGURED, unused)).status, 401);
});

test("空需求不触发 routine", async () => {
  const session = await signSession("session-secret", OCTOCAT);
  assert.equal((await handleBuildFire(post({ request: "   ", session }), CONFIGURED, unused)).status, 400);
});

test("触发时把 runId、需求和合著者包成 fire text，回传会话链接和分支", async () => {
  const session = await signSession("session-secret", OCTOCAT);
  let seen: { url: string; init: RequestInit } | null = null;
  const response = await handleBuildFire(post({ request: " Underline footer links ", session }), CONFIGURED, async (input, init) => {
    seen = { url: String(input), init: init ?? {} };
    return Response.json({ type: "routine_fire", claude_code_session_url: "https://claude.ai/code/session_x" });
  });

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
  assert.deepEqual(JSON.parse(text), {
    runId: result.runId,
    request: "Underline footer links",
    coauthor: "The Octocat <583231+octocat@users.noreply.github.com>",
  });
});

test("routine 拒绝时把上游的错误原因带回页面", async () => {
  const session = await signSession("session-secret", OCTOCAT);
  const response = await handleBuildFire(post({ request: "x", session }), CONFIGURED, async () =>
    Response.json({ type: "error", error: { type: "rate_limit_error", message: "Fire limit reached" } }, { status: 429 }),
  );
  assert.equal(response.status, 502);
  assert.match(((await response.json()) as { error: string }).error, /Fire limit reached/);
});

test("登录换出身份后立刻撤销访客令牌，签发的会话能直接用来触发", async () => {
  const calls: string[] = [];
  const response = await withGlobalFetch(async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "ghu_visitor" });
    if (url === "https://api.github.com/user") {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer ghu_visitor");
      return Response.json({ login: "octocat", id: 583231, name: "The Octocat" });
    }
    if (url.endsWith("/token") && init?.method === "DELETE") return new Response(null, { status: 204 });
    throw new Error(`unexpected ${url}`);
  }, () => handleBuildSession(post({ code: "abc123" }), CONFIGURED));

  assert.equal(response.status, 200);
  assert.ok(calls.some((call) => call.startsWith("DELETE ") && call.endsWith("/token")), "访客令牌必须撤销");
  const session = (await response.json()) as { session: string; login: string };
  assert.equal(session.login, "octocat");
  const connected = await readSession("session-secret", session.session);
  assert.equal(connected?.id, 583231);
});

test("GitHub 换不出令牌时不签发会话", async () => {
  const response = await withGlobalFetch(
    async () => Response.json({ error: "bad_verification_code" }),
    () => handleBuildSession(post({ code: "abc123" }), CONFIGURED),
  );
  assert.equal(response.status, 401);
});
