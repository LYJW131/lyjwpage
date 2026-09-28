import assert from "node:assert/strict";
import { test } from "node:test";
import { LAG_KEYS, type LagEntry } from "@shared/lag";
import { installLagStoreForTests } from "./lag-store.ts";
import { fetchVercelDeployments, getVercelDeployments, parseVercelDeployment } from "./vercel-deployments.ts";

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

test("the public payload composes three lag keys; metrics and PageSpeed are optional, deployments are not", async (t) => {
  const deployments = { fetchedAt: 30, production: null, recent: [] };
  const metrics = { functions: null, analytics: { fetchedAt: 10, start: 0, end: 10, pageviews: 5, visitors: 2 } };
  const pagespeed = { fetchedAt: 20, start: 5, samples: 3, url: "https://lyjw.me", desktop: null, mobile: null };
  const store = new Map<string, LagEntry<unknown>>([
    [LAG_KEYS.vercelDeployments, { updatedAt: 30, data: deployments }],
    [LAG_KEYS.vercelMetrics, { updatedAt: 10, data: metrics }],
    [LAG_KEYS.pagespeed, { updatedAt: 20, data: pagespeed }],
  ]);
  installLagStoreForTests(async (key) => store.get(key) ?? null);
  t.after(() => installLagStoreForTests(null));

  const result = await getVercelDeployments();
  assert.equal(result.updatedAt, 30, "信封跟最常刷新的部署那条");
  assert.deepEqual(result.data, { ...deployments, metrics, pagespeed });

  store.delete(LAG_KEYS.pagespeed);
  store.delete(LAG_KEYS.vercelMetrics);
  assert.deepEqual((await getVercelDeployments()).data, { ...deployments, metrics: null, pagespeed: null });

  store.delete(LAG_KEYS.vercelDeployments);
  await assert.rejects(getVercelDeployments(), /Waiting/);
});
