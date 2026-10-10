import assert from "node:assert/strict";
import test from "node:test";

import type { BuildRun } from "@shared/build-routine";

import { PREVIEW_SHARE_TTL_S, vercelDeploymentId, withPreviewShare } from "./build/preview-share.ts";
import type { Env } from "./runtime.ts";

const env = { VERCEL_TOKEN: "vercel-fixture", VERCEL_TEAM_ID: "team_fixture" } as Env;
const inspector = "https://vercel.com/team/lyjwpage/4oxzq9oFjj91NKRpUtgWjQ62d8nH";
const run: BuildRun = { runId: "r".repeat(32), branch: "claude/build-fixture", phase: "pr_open", createdAt: 0, updatedAt: 0 };
const ready: Partial<BuildRun> = { preview: { state: "success", url: inspector, updatedAt: 1 } };

function vercel(branch = run.branch) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    if (url.includes("/v13/deployments/")) return Response.json({ url: "lyjwpage-abc.vercel.app", meta: { githubCommitRef: branch } });
    return Response.json({ protectionBypass: {
      older: { scope: "shareable-link", createdAt: 1, expires: 10 },
      newest: { scope: "shareable-link", createdAt: 2, expires: 2_000_000_000 },
      automation: { scope: "automation-bypass", createdAt: 3 },
    } });
  }) as typeof fetch;
  return { calls, fetcher };
}

test("Vercel 部署页 URL 解析出部署 ID，其他地址不认", () => {
  assert.equal(vercelDeploymentId(inspector), "dpl_4oxzq9oFjj91NKRpUtgWjQ62d8nH");
  assert.equal(vercelDeploymentId("https://dash.cloudflare.com/x/4oxzq9oFjj91NKRpUtgWjQ62d8nH"), null);
  assert.equal(vercelDeploymentId(undefined), null);
});

test("构建分支的预览部署成功后换成带分享参数的公开链接", async () => {
  const { calls, fetcher } = vercel();
  const patch = await withPreviewShare(env, run, ready, fetcher);
  assert.equal(patch.preview?.url, "https://lyjwpage-abc.vercel.app/?_vercel_share=newest");
  assert.deepEqual(patch.previewShare, { deploymentId: "dpl_4oxzq9oFjj91NKRpUtgWjQ62d8nH", url: patch.preview?.url, expiresAt: 2_000_000_000_000 });
  assert.equal(calls[1].method, "PATCH");
  assert.match(calls[1].url, /\/aliases\/dpl_4oxzq9oFjj91NKRpUtgWjQ62d8nH\/protection-bypass\?teamId=team_fixture$/);
  assert.deepEqual(JSON.parse(calls[1].body!), { ttl: PREVIEW_SHARE_TTL_S });
});

test("同一部署已有未过期的分享链接时直接沿用，不再调用 Vercel", async () => {
  const { calls, fetcher } = vercel();
  const share = { deploymentId: "dpl_4oxzq9oFjj91NKRpUtgWjQ62d8nH", url: "https://kept.vercel.app/?_vercel_share=kept", expiresAt: Date.now() + 60_000 };
  const patch = await withPreviewShare(env, { ...run, previewShare: share }, ready, fetcher);
  assert.equal(patch.preview?.url, share.url);
  assert.equal(calls.length, 0);
});

test("不属于这个构建分支的部署、未就绪的预览或缺凭据时保持原链接", async () => {
  const other = vercel("main");
  assert.deepEqual(await withPreviewShare(env, run, ready, other.fetcher), ready);
  assert.equal(other.calls.length, 1);
  const pending: Partial<BuildRun> = { preview: { state: "pending", url: inspector, updatedAt: 1 } };
  assert.deepEqual(await withPreviewShare(env, run, pending, vercel().fetcher), pending);
  assert.deepEqual(await withPreviewShare({} as Env, run, ready, vercel().fetcher), ready);
});
