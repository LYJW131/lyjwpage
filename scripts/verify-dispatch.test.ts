import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { stampRerun } from "./verify-action/body.ts";
import { main } from "./verify-dispatch.ts";

const ID = "VERIFY_RERUN_ID";

function withId(id: string | undefined, run: () => Promise<unknown>) {
  const prev = process.env[ID];
  if (id === undefined) delete process.env[ID];
  else process.env[ID] = id;
  return run().finally(() => {
    if (prev === undefined) delete process.env[ID];
    else process.env[ID] = prev;
  });
}

function fakeFetch(pull: { state?: string; draft?: boolean; body?: string | null }, patchStatus = 200) {
  const calls: { url: string; method?: string; body?: string }[] = [];
  const fetchImpl = async (url: string, init: { method?: string; body?: string }) => {
    calls.push({ url, method: init.method, body: init.body });
    const path = url.split("/repos/LYJW131/lyjwpage/")[1] ?? "";
    if (path === "pulls/7" && (init.method ?? "GET") === "GET") return { ok: true, status: 200, json: async () => pull };
    if (path === "pulls/7" && init.method === "PATCH") return { ok: patchStatus === 200, status: patchStatus, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchImpl, calls };
}

test("参数错退出 2，不读 GitHub", async () => {
  for (const argv of [["--pr", "nope"], ["--pr", "0"], ["--pr", "7e1"], ["--pr", "7", "--nope"], ["--pr"]]) {
    await withId("1-1", async () => {
      await assert.rejects(main(argv, async () => assert.fail("不该读 GitHub")), (error: Error) => error.constructor.name === "UsageError", argv.join(" "));
    });
  }
  await withId(undefined, async () => {
    await assert.rejects(main(["--pr", "7"], async () => assert.fail("不该读 GitHub")), (error: Error) => error.constructor.name === "UsageError");
  });
  await withId("1-1\n2-1", async () => {
    await assert.rejects(main(["--pr", "7"], async () => assert.fail("不该读 GitHub")), (error: Error) => error.constructor.name === "UsageError");
  });
  const prev = process.env.PR;
  delete process.env.PR;
  try {
    await withId("1-1", async () => {
      await assert.rejects(main([], async () => assert.fail("不该读 GitHub")), (error: Error) => error.constructor.name === "UsageError");
    });
  } finally {
    if (prev === undefined) delete process.env.PR;
    else process.env.PR = prev;
  }
});

test("没给 --pr 时用环境变量 PR", async () => {
  const prev = process.env.PR;
  process.env.PR = "7";
  try {
    await withId("42-1", async () => {
      const { fetchImpl, calls } = fakeFetch({ state: "open", body: "x" });
      assert.equal(await main([], fetchImpl), 0);
      assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
    });
  } finally {
    if (prev === undefined) delete process.env.PR;
    else process.env.PR = prev;
  }
});

test("打开的 PR 只追加重跑标记，草稿、关闭和写失败都不写成触发", async () => {
  await withId("42-1", async () => {
    const { fetchImpl, calls } = fakeFetch({ state: "open", body: "要支持筛选\n" });
    assert.equal(await main(["--pr", "7"], fetchImpl), 0);
    const patch = calls.find((call) => call.method === "PATCH");
    const body = JSON.parse(patch?.body ?? "{}").body as string;
    assert.match(body, /^要支持筛选\n\n<!-- verify-rerun-begin -->\n42-1\n<!-- verify-rerun-end -->\n$/);
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
  });
  await withId("42-1", async () => {
    const { fetchImpl, calls } = fakeFetch({ state: "open", draft: true, body: "x" });
    await assert.rejects(main(["--pr", "7"], fetchImpl), /草稿/);
    assert.equal(calls.some((call) => call.method === "PATCH"), false);
  });
  await withId("42-1", async () => {
    const { fetchImpl, calls } = fakeFetch({ state: "closed", body: "x" });
    await assert.rejects(main(["--pr", "7"], fetchImpl), /不是打开的/);
    assert.equal(calls.some((call) => call.method === "PATCH"), false);
  });
  await withId("42-1", async () => {
    await assert.rejects(main(["--pr", "8"], fakeFetch({ state: "open", body: "x" }).fetchImpl), /HTTP 404/);
  });
  await withId("42-1", async () => {
    await assert.rejects(main(["--pr", "7"], fakeFetch({ state: "open", body: "x" }, 500).fetchImpl), /HTTP 500/);
  });
  await withId("42-1", async () => {
    const body = stampRerun("要支持筛选", "42-1");
    const { fetchImpl, calls } = fakeFetch({ state: "open", body });
    await assert.rejects(main(["--pr", "7"], fetchImpl), /不会再触发/);
    assert.equal(calls.some((call) => call.method === "PATCH"), false);
  });
});

test("verify.yml 不挂 workflow_dispatch，手动入口不检出 PR head", () => {
  const verify = fs.readFileSync(".github/workflows/verify.yml", "utf8");
  const triggers = verify.split(/^jobs:/m)[0].replace(/^\s*#.*$/gm, "");
  const dispatch = fs.readFileSync(".github/workflows/verify-dispatch.yml", "utf8");
  assert.doesNotMatch(triggers, /workflow_dispatch/);
  assert.doesNotMatch(triggers, /inputs/);
  assert.match(dispatch, /workflow_dispatch:/);
  assert.match(dispatch, /package-manager-cache: false/);
  assert.doesNotMatch(dispatch, /needs\.plan\.outputs\.head|pull_request\.head|cache: pnpm/);
  assert.doesNotMatch(dispatch, /^\s*ref:/m);
});
