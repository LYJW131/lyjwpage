import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchVercelDeployments, parseVercelDeployment } from "./vercel-deployments.ts";

const deployment = (id = "active", state = "READY", created = 1000) => ({
  id, state, created, target: "production", buildingAt: 1100, ready: 1500,
  meta: { githubCommitSha: "a".repeat(40), githubCommitRef: "main", githubCommitMessage: "Fix card\nPrivate details", secret: "hidden" },
  env: ["private"], creator: { email: "private@example.com" },
});

test("deployment projection excludes private fields and normalizes status and duration", () => {
  const result = parseVercelDeployment(deployment());
  assert.equal(result.buildDurationMs, 400);
  assert.equal(result.commit?.message, "Fix card");
  assert.doesNotMatch(JSON.stringify(result), /private|hidden|secret|env|email/i);
  assert.equal(parseVercelDeployment(deployment("new", "FUTURE_STATE")).state, "UNKNOWN");
  assert.equal(parseVercelDeployment({ ...deployment(), ready: 0 }).buildDurationMs, null);
  assert.throws(() => parseVercelDeployment({ id: "bad", created: NaN }));
});

test("active production remains the project target when the newest deployment fails or a rollback is older", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    assert.equal(url.origin, "https://api.vercel.com");
    assert.equal(url.searchParams.get("teamId"), "team-test");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-secret");
    if (url.pathname === "/v9/projects/project-test") return Response.json({ targets: { production: { id: "active" } } });
    if (url.pathname === "/v6/deployments") return Response.json({ deployments: [deployment("failed", "ERROR", 2000), deployment("previous", "READY", 1800)].map(({ id, ...row }) => ({ ...row, uid: id })) });
    assert.equal(url.pathname, "/v13/deployments/active");
    return Response.json(deployment());
  });
  const result = await fetchVercelDeployments("project-test", "team-test", "test-secret");
  assert.equal(result.production?.id, "active");
  assert.equal(result.recent[0].state, "ERROR");
  assert.equal(calls.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /test-secret|team-test/);
});

test("an empty project is distinct from an upstream permission error", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => Response.json(
    String(input).includes("/projects/") ? { targets: {} } : { deployments: [] },
  ));
  assert.deepEqual((await fetchVercelDeployments("p", "t", "s")).recent, []);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: { message: "private upstream detail" } }, { status: 403 }));
  await assert.rejects(fetchVercelDeployments("p", "t", "s"), /Vercel 查询失败 \(403\)/);
});
