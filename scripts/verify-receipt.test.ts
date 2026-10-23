import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { check, coverage, evaluate, parseComments, patchDigest, signLine } from "./verify-receipt.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const patchIds = (map: Record<string, string>) => (sha: string) => map[sha] ?? null;
const owner = { id: 41898282 };
const lyjw = { id: 153256373 };

test("parseComments 每类只认 github-actions[bot] 发的最新一条，lyjw 账号自签的与第一行不对格式的不算", () => {
  const { receipt, judge } = parseComments([
    { user: owner, body: `验证回执 ${OLD}：type-check-only` },
    { user: owner, body: `顺便说一句\n验证回执 ${HEAD}：live-ui-verified` },
    { user: owner, body: `验证回执 ${HEAD}：unit-test-verified\n证据：…` },
    { user: owner, body: `判定 ${HEAD}：FAIL` },
    { user: owner, body: `判定 ${HEAD}: PASS` },
    { user: lyjw, body: `验证回执 ${HEAD}：live-ui-verified` },
    { user: { id: 300701323 }, body: `判定 ${OLD}：FAIL` },
    { body: `验证回执 ${OLD}：live-ui-verified` },
  ]);
  assert.deepEqual([receipt?.sha, receipt?.level], [HEAD, "unit-test-verified"]);
  assert.deepEqual([judge?.sha, judge?.verdict], [HEAD, "PASS"]);
});

test("coverage：同一提交、补丁相同沿用、补丁不同作废、算不出补丁也作废", () => {
  assert.equal(coverage(HEAD, HEAD, () => assert.fail()), "exact");
  assert.equal(coverage(OLD, HEAD, patchIds({ [OLD]: "p1", [HEAD]: "p1" })), "carried");
  assert.equal(coverage(OLD, HEAD, patchIds({ [OLD]: "p1", [HEAD]: "p2" })), "stale");
  assert.equal(coverage(OLD, HEAD, () => { throw new Error("no git"); }), "stale");
});

test("回执盖住 head 且等级够就通过，主线程不再重验", () => {
  const result = evaluate({
    head: HEAD,
    receipt: { sha: OLD, level: "live-ui-verified" },
    judge: null,
    need: "unit-test-verified",
    wantJudge: false,
    patchId: patchIds({ [OLD]: "p", [HEAD]: "p" }),
  });
  assert.equal(result.pass, true);
  assert.equal(result.receipt?.coverage, "carried");
});

test("等级不够、blocked、过期的回执都不通过并写下一步", () => {
  const base = { head: HEAD, judge: null, need: "unit-test-verified", wantJudge: false, patchId: patchIds({}) };
  assert.match(evaluate({ ...base, receipt: { sha: HEAD, level: "type-check-only" } }).next ?? "", /低于要求/);
  assert.match(evaluate({ ...base, receipt: { sha: HEAD, level: "verifier-blocked" } }).next ?? "", /不是通过/);
  assert.match(evaluate({ ...base, receipt: { sha: OLD, level: "live-ui-verified" } }).next ?? "", /按新 head 跑完/);
  assert.match(evaluate({ ...base, receipt: null }).next ?? "", /没有验证回执/);
});

test("--judge 时还要 PASS 的判定盖住 head", () => {
  const base = {
    head: HEAD,
    receipt: { sha: HEAD, level: "unit-test-verified" },
    need: "unit-test-verified",
    wantJudge: true,
    patchId: patchIds({}),
  };
  assert.match(evaluate({ ...base, judge: null }).next ?? "", /没有判定/);
  assert.match(evaluate({ ...base, judge: { sha: HEAD, verdict: "FAIL" } }).next ?? "", /FAIL/);
  assert.match(evaluate({ ...base, judge: { sha: OLD, verdict: "PASS" } }).next ?? "", /重判/);
  assert.equal(evaluate({ ...base, judge: { sha: HEAD, verdict: "PASS" } }).pass, true);
});

test("check 读 PR head 与分页评论", async () => {
  const fetch = async (url: string) => {
    if (url.endsWith("/pulls/7")) return { ok: true, json: async () => ({ head: { sha: HEAD } }) };
    const page = Number(new URL(url).searchParams.get("page"));
    const body = page === 1
      ? Array.from({ length: 100 }, () => ({ body: "普通评论" }))
      : [{ user: owner, body: `验证回执 ${HEAD}：unit-test-verified` }];
    return { ok: true, json: async () => body };
  };
  const result = await check({ pr: 7, need: "unit-test-verified", wantJudge: false }, { fetch, patchId: patchIds({}) });
  assert.equal(result.pass, true);
  assert.equal(result.receipt?.coverage, "exact");
});

test("patchDigest 只忽略行号，空白和二进制内容变了都算补丁变了", () => {
  const diff = (header: string, line: string) => `diff --git a/x b/x\nindex 1111111..2222222 100644\n${header}\n${line}\n`;
  const a = patchDigest(diff("@@ -1,2 +1,2 @@", '+const label = "a b"'));
  assert.equal(a, patchDigest(diff("@@ -40,2 +40,2 @@", '+const label = "a b"')));
  assert.notEqual(a, patchDigest(diff("@@ -1,2 +1,2 @@", '+const label = "ab"')));
  const bin = (blob: string) => `diff --git a/i.png b/i.png\nindex 0000000..${blob}\nGIT binary patch\nliteral 4\n`;
  assert.notEqual(patchDigest(bin("aaaaaaa")), patchDigest(bin("bbbbbbb")));
  assert.equal(patchDigest(""), null);
});

test("signLine 用 rev-parse 展开的完整 SHA 写第一行，parseComments 认得出来", () => {
  const revParse = (ref: string) => (ref === "abc1234" ? HEAD : assert.fail(ref));
  const receipt = signLine({ ref: "abc1234", level: "unit-test-verified" }, revParse);
  const judge = signLine({ ref: "abc1234", verdict: "PASS" }, revParse);
  assert.equal(receipt, `验证回执 ${HEAD}：unit-test-verified`);
  const parsed = parseComments([{ user: owner, body: `${receipt}\n证据：…` }, { user: owner, body: judge }]);
  assert.deepEqual([parsed.receipt?.sha, parsed.receipt?.level, parsed.judge?.verdict], [HEAD, "unit-test-verified", "PASS"]);
});

test("signLine 拒收自拟等级、等级与判定同给或都不给、展开不成完整 SHA", () => {
  const revParse = () => HEAD;
  assert.throws(() => signLine({ ref: "x", level: "local-ui-verified" }, revParse), /等级只收/);
  assert.throws(() => signLine({ ref: "x", level: "type-check-only", verdict: "PASS" }, revParse), /二选一/);
  assert.throws(() => signLine({ ref: "x" }, revParse), /二选一/);
  assert.throws(() => signLine({ ref: "x", verdict: "pass" }, revParse), /PASS、FAIL/);
  assert.throws(() => signLine({ ref: "x", level: "type-check-only" }, () => "abc"), /完整 SHA/);
});

test("命令行：别的子命令的选项按用法错退出 2，不悄悄用默认值", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/verify-receipt.ts", ...args], { encoding: "utf8" }).status;
  assert.equal(run("check", "--pr", "7", "--level", "live-ui-verified"), 2);
  assert.equal(run("sign", "--sha", "HEAD", "--need", "live-ui-verified"), 2);
  assert.equal(run("sign", "--level", "unit-test-verified"), 2);
  assert.equal(run("sign", "--sha", "HEAD", "--level", "unit-test-verified"), 0);
});
