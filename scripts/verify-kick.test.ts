import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { main, queueRunVerify, RUN_VERIFY_LABEL, type FetchLike } from "./verify-kick.ts";

const saved = { DEFAULT_REF: process.env.DEFAULT_REF, GITHUB_REF: process.env.GITHUB_REF };

function restoreEnv() {
  for (const key of ["DEFAULT_REF", "GITHUB_REF"] as const) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

type Route = { status: number; body?: unknown };
type Call = { method: string; path: string; body?: unknown };

function github(routes: Record<string, Route | ((call: Call) => Route)>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const path = url.replace("https://api.github.com/repos/LYJW131/lyjwpage/", "");
    const call = { method: init.method ?? "GET", path, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const route = routes[`${call.method} ${path}`];
    if (!route) return { ok: false, status: 500, json: async () => ({ message: "unexpected" }) };
    const result = typeof route === "function" ? route(call) : route;
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body ?? {} };
  };
  return { calls, fetchImpl };
}

test("参数错不读 GitHub", async () => {
  restoreEnv();
  delete process.env.DEFAULT_REF;
  delete process.env.GITHUB_REF;
  for (const argv of [[], ["--pr", "0"], ["--pr", "-3"], ["--pr", "1.5"], ["--pr", "abc"], ["--nope"]]) {
    await assert.rejects(main(argv, async () => assert.fail("不该读 GitHub")), (error: Error) => error.constructor.name === "UsageError", argv.join(" "));
  }
});

test("不在默认分支上时不碰 API", async () => {
  process.env.DEFAULT_REF = "refs/heads/main";
  process.env.GITHUB_REF = "refs/heads/feature";
  await assert.rejects(queueRunVerify(7, async () => assert.fail("不该读 GitHub")), /默认分支/);
  restoreEnv();
});

test("标签还不存在：建标签、揭掉（没有也行）、贴上、再揭掉", async () => {
  delete process.env.DEFAULT_REF;
  delete process.env.GITHUB_REF;
  const { calls, fetchImpl } = github({
    "GET pulls/7": { status: 200, body: { number: 7 } },
    [`GET labels/${RUN_VERIFY_LABEL}`]: { status: 404 },
    "POST labels": { status: 201, body: { name: RUN_VERIFY_LABEL } },
    [`DELETE issues/7/labels/${RUN_VERIFY_LABEL}`]: { status: 404 },
    "POST issues/7/labels": { status: 200, body: [{ name: RUN_VERIFY_LABEL }] },
  });
  let deletes = 0;
  let read204 = false;
  const seen: string[] = [];
  const wrapped: FetchLike = async (url, init) => {
    const path = url.replace("https://api.github.com/repos/LYJW131/lyjwpage/", "");
    seen.push(`${init.method ?? "GET"} ${path}`);
    if ((init.method ?? "GET") === "DELETE") {
      deletes += 1;
      if (deletes === 2) return { ok: true, status: 204, json: async () => { read204 = true; return {}; } };
    }
    return fetchImpl(url, init);
  };
  await queueRunVerify(7, wrapped);
  assert.deepEqual(seen, [
    "GET pulls/7",
    `GET labels/${RUN_VERIFY_LABEL}`,
    "POST labels",
    `DELETE issues/7/labels/${RUN_VERIFY_LABEL}`,
    "POST issues/7/labels",
    `DELETE issues/7/labels/${RUN_VERIFY_LABEL}`,
  ]);
  assert.equal(read204, false);
  assert.deepEqual(calls[2].body, { name: RUN_VERIFY_LABEL, color: "5319e7", description: "Queues a Verify run. The merge gate does not read this label." });
  assert.deepEqual(calls[4].body, { labels: [RUN_VERIFY_LABEL] });
  assert.equal(deletes, 2);
  restoreEnv();
});

test("标签已在仓库和 PR 上：先揭再贴再揭，422 already_exists 不当失败", async () => {
  delete process.env.DEFAULT_REF;
  delete process.env.GITHUB_REF;
  let deletes = 0;
  const { calls, fetchImpl } = github({
    "GET pulls/7": { status: 200, body: { number: 7 } },
    [`GET labels/${RUN_VERIFY_LABEL}`]: { status: 404 },
    "POST labels": { status: 422, body: { errors: [{ code: "already_exists" }] } },
    "POST issues/7/labels": { status: 200, body: [] },
  });
  const wrapped: FetchLike = async (url, init) => {
    if ((init.method ?? "GET") === "DELETE") {
      deletes += 1;
      return { ok: true, status: 204, json: async () => ({}) };
    }
    return fetchImpl(url, init);
  };
  await queueRunVerify(7, wrapped);
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "GET", "POST", "POST"],
  );
  assert.equal(deletes, 2);
  restoreEnv();
});

test("PR 不存在、建标签失败、收尾揭标签失败都不当成排上了", async () => {
  delete process.env.DEFAULT_REF;
  delete process.env.GITHUB_REF;
  const missing = github({ "GET pulls/9": { status: 404, body: { message: "Not Found" } } });
  await assert.rejects(queueRunVerify(9, missing.fetchImpl), /HTTP 404/);
  assert.deepEqual(missing.calls.map((call) => call.method), ["GET"]);

  const badLabel = github({
    "GET pulls/7": { status: 200, body: { number: 7 } },
    [`GET labels/${RUN_VERIFY_LABEL}`]: { status: 404 },
    "POST labels": { status: 422, body: { errors: [{ code: "invalid" }] } },
  });
  await assert.rejects(queueRunVerify(7, badLabel.fetchImpl), /建 run-verify 标签失败/);

  const stuck = github({
    "GET pulls/7": { status: 200, body: { number: 7 } },
    [`GET labels/${RUN_VERIFY_LABEL}`]: { status: 200, body: { name: RUN_VERIFY_LABEL } },
    [`DELETE issues/7/labels/${RUN_VERIFY_LABEL}`]: { status: 404 },
    "POST issues/7/labels": { status: 200, body: [] },
  });
  let deletes = 0;
  const wrapped: FetchLike = async (url, init) => {
    if ((init.method ?? "GET") === "DELETE") {
      deletes += 1;
      if (deletes === 2) return { ok: false, status: 500, json: async () => ({}) };
    }
    return stuck.fetchImpl(url, init);
  };
  await assert.rejects(queueRunVerify(7, wrapped), /HTTP 500/);
  restoreEnv();
});

test("verify.yml 不再带 workflow_dispatch；run-verify 贴上重跑、揭掉不进正组", () => {
  const verify = fs.readFileSync(".github/workflows/verify.yml", "utf8");
  const dispatch = fs.readFileSync(".github/workflows/verify-dispatch.yml", "utf8");
  assert.equal(verify.includes("workflow_dispatch"), false);
  assert.match(verify, /github\.event\.action == 'labeled' && github\.event\.label\.name == 'run-verify'/);
  assert.match(verify, /github\.event\.label\.name != 'run-verify'/);
  assert.equal(verify.includes("unlabeled") && verify.includes("run-verify"), true);
  assert.doesNotMatch(verify, /action == 'unlabeled' && github\.event\.label\.name != 'run-verify'/);
  assert.match(dispatch, /workflow_dispatch:/);
  assert.match(dispatch, /node scripts\/verify-kick\.ts/);
  assert.match(dispatch, /GITHUB_TOKEN: \$\{\{ steps\.app\.outputs\.token \}\}/);
  assert.equal(dispatch.includes("needs.plan.outputs.head"), false);
  assert.doesNotMatch(dispatch, /^\s*cache:/m);
  assert.equal(dispatch.includes("actions/cache"), false);
  assert.equal(RUN_VERIFY_LABEL, "run-verify");
});
