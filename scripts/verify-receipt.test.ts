import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { bodyDigest } from "./verify-action/body.ts";
import { check, coverage, evaluate, parseComments, patchDigest, signStamp, stampLine, stampTitle, type Stamp } from "./verify-receipt.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const patchIds = (map: Record<string, string>) => (sha: string) => map[sha] ?? null;
const owner = { id: 338272049 };
const lyjw = { id: 153256373 };
const DIGEST = "c".repeat(64);
const stamp = (extra: Partial<Stamp>) => {
  const full = { sha: HEAD, body: DIGEST, ...extra };
  return `${stampTitle(full)}\n${stampLine(full)}`;
};

test("parseComments 每类只认 lyjw131[bot] 发的最新一条第二行 JSON 戳，中文行、别的行上的戳、lyjw 账号或 github-actions[bot] 发的与不合格式的戳都不算", () => {
  const { receipt, judge } = parseComments([
    { user: owner, body: stamp({ sha: OLD, level: "type-check-only" }) },
    { user: owner, body: `${stamp({ level: "unit-test-verified" })}\n证据：…` },
    { user: owner, body: stampLine({ sha: HEAD, body: DIGEST, level: "live-ui-verified" }) },
    { user: owner, body: `Jev 的意见\n说明\n${stampLine({ sha: HEAD, body: DIGEST, level: "live-ui-verified" })}` },
    { user: owner, body: `验证回执 ${HEAD}：live-ui-verified` },
    { user: owner, body: stamp({ level: "made-up" }) },
    { user: owner, body: stamp({ level: "live-ui-verified", verdict: "PASS" }) },
    { user: owner, body: stamp({ level: "live-ui-verified", body: "short" }) },
    { user: owner, body: "标题\n<!-- verify-stamp {not json} -->" },
    { user: owner, body: stamp({ verdict: "FAIL" }) },
    { user: owner, body: stamp({ verdict: "PASS" }) },
    { user: lyjw, body: stamp({ level: "live-ui-verified" }) },
    { user: { id: 300701323 }, body: stamp({ sha: OLD, verdict: "FAIL" }) },
    { user: { id: 41898282 }, body: stamp({ level: "live-ui-verified" }) },
    { user: { id: 41898282 }, body: stamp({ verdict: "FAIL" }) },
    { body: stamp({ level: "live-ui-verified" }) },
  ]);
  assert.deepEqual([receipt?.sha, receipt?.level, receipt?.body], [HEAD, "unit-test-verified", DIGEST]);
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
  assert.match(evaluate({ ...base, receipt: null }).next ?? "", /Verify Dispatch/);
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

test("check 读 PR head、描述与分页评论，描述在回执之后改过就不算", async () => {
  const signed = "## 验证清单\n- V1：单测绿\n## lyjw 原话\n> 修好";
  const fetchWith = (prBody: string) => async (url: string) => {
    if (url.endsWith("/pulls/7")) return { ok: true, json: async () => ({ head: { sha: HEAD }, body: prBody }) };
    const page = Number(new URL(url).searchParams.get("page"));
    const body = page === 1
      ? Array.from({ length: 100 }, () => ({ body: "普通评论" }))
      : [{ user: owner, body: stamp({ level: "unit-test-verified", body: await bodyDigest(signed) }) }];
    return { ok: true, json: async () => body };
  };
  const args = { pr: 7, need: "unit-test-verified", wantJudge: false };
  const result = await check(args, { fetch: fetchWith(`说明改了不算\n${signed}`), patchId: patchIds({}) });
  assert.equal(result.pass, true);
  assert.equal(result.receipt?.coverage, "exact");
  const edited = await check(args, { fetch: fetchWith(signed.replace("单测绿", "单测绿\n- V2：加了一项")), patchId: patchIds({}) });
  assert.equal(edited.pass, false);
  assert.match(edited.next ?? "", /描述的验证清单或 lyjw 原话改过/);
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

test("signStamp 用 rev-parse 展开完整 SHA，拒收自拟等级、等级与判定同给或都不给、展开不成完整 SHA", () => {
  const revParse = (ref: string) => (ref === "abc1234" ? HEAD : assert.fail(ref));
  assert.deepEqual(signStamp({ ref: "abc1234", level: "unit-test-verified" }, revParse), { sha: HEAD, level: "unit-test-verified" });
  assert.deepEqual(signStamp({ ref: "abc1234", verdict: "PASS" }, revParse), { sha: HEAD, verdict: "PASS" });
  const any = () => HEAD;
  assert.throws(() => signStamp({ ref: "x", level: "local-ui-verified" }, any), /等级只收/);
  assert.throws(() => signStamp({ ref: "x", level: "type-check-only", verdict: "PASS" }, any), /二选一/);
  assert.throws(() => signStamp({ ref: "x" }, any), /二选一/);
  assert.throws(() => signStamp({ ref: "x", verdict: "pass" }, any), /PASS、FAIL/);
  assert.throws(() => signStamp({ ref: "x", level: "type-check-only" }, () => "abc"), /完整 SHA/);
});

test("命令行：别的子命令的选项按用法错退出 2，不悄悄用默认值", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/verify-receipt.ts", ...args], { encoding: "utf8" }).status;
  assert.equal(run("check", "--pr", "7", "--level", "live-ui-verified"), 2);
  assert.equal(run("sign", "--sha", "HEAD", "--need", "live-ui-verified"), 2);
  assert.equal(run("sign", "--level", "unit-test-verified"), 2);
  assert.equal(run("sign", "--sha", "HEAD", "--level", "unit-test-verified"), 0);
});
