import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { bodyDigest } from "./verify-action/body.ts";
import { isRuleOrVerifierFile, notesOnlyFiles, parseRawDiff, prTier } from "./verify-receipt/notes-only.ts";
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

test("coverage：补丁不同但之后只改了文档或注释也沿用，判断出错就作废", () => {
  const differ = patchIds({ [OLD]: "p1", [HEAD]: "p2" });
  assert.equal(coverage(OLD, HEAD, differ, () => ["README.md"]), "notes-only");
  assert.equal(coverage(OLD, HEAD, differ, () => null), "stale");
  assert.equal(coverage(OLD, HEAD, differ, () => { throw new Error("no ts"); }), "stale");
});

test("parseRawDiff：模式变了记 modeChanged，新增与删除不算", () => {
  const z = "0".repeat(40);
  const h = "1".repeat(40);
  const raw = [`:100755 100644 ${h} ${h} M\t.claude/hooks/session-start.sh`, `:000000 100644 ${z} ${h} A\tdocs/new.md`, `:100644 100644 ${h} ${z} M\tREADME.md`, ""].join("\n");
  assert.deepEqual(parseRawDiff(raw), [
    { file: ".claude/hooks/session-start.sh", modeChanged: true },
    { file: "docs/new.md", modeChanged: false },
    { file: "README.md", modeChanged: false },
  ]);
});

test("notesOnlyFiles：文档档的文件直接放过，代码文件要逐个证明只改了注释", () => {
  const compare = (statuses: Record<string, string>) => (files: string[]) => files.map((file) => ({ file, status: statuses[file] ?? "code" }));
  assert.deepEqual(notesOnlyFiles(["docs/a.md", ".claude/memory/x.md"], () => assert.fail()), ["docs/a.md", ".claude/memory/x.md"]);
  assert.deepEqual(notesOnlyFiles(["README.md", "scripts/a.ts"], compare({ "scripts/a.ts": "comment-only" })), ["README.md", "scripts/a.ts"]);
  assert.equal(notesOnlyFiles(["scripts/a.ts"], compare({ "scripts/a.ts": "directive" })), null);
  assert.equal(notesOnlyFiles(["scripts/new.ts"], compare({ "scripts/new.ts": "new" })), null);
  assert.equal(notesOnlyFiles([".github/workflows/verify.yml"], compare({})), null);
  assert.equal(notesOnlyFiles([".claude/settings.json"], compare({})), null);
  assert.equal(notesOnlyFiles(["src/components/a.tsx"], compare({})), null);
});

test("isRuleOrVerifierFile：规则文档与验证员自己的文件算，普通文档与记忆不算", () => {
  for (const file of ["AGENTS.md", "workers/ai/AGENTS.md", "CLAUDE.md", "workers/ai/CLAUDE.md", "HUMAN.md", "REVIEW.md", "DESIGN.md", ".claude/skills/lyjwpage-verify/SKILL.md", ".claude/rules/routines.md", "scripts/verify-action/prompts.ts", "scripts/revert-proof.ts"]) {
    assert.equal(isRuleOrVerifierFile(file), true, file);
  }
  for (const file of ["docs/a.md", ".claude/memory/x.md", "README.md", "scripts/a.ts"]) assert.equal(isRuleOrVerifierFile(file), false, file);
});

test("coverage：之间改了规则文档，补丁相同或只改文档也作废，判断出错也作废", () => {
  const same = patchIds({ [OLD]: "p1", [HEAD]: "p1" });
  const differ = patchIds({ [OLD]: "p1", [HEAD]: "p2" });
  assert.equal(coverage(OLD, HEAD, same, undefined, () => true), "stale");
  assert.equal(coverage(OLD, HEAD, differ, () => ["AGENTS.md"], () => true), "stale");
  assert.equal(coverage(OLD, HEAD, same, undefined, () => false), "carried");
  assert.equal(coverage(OLD, HEAD, same, undefined, () => { throw new Error("no git"); }), "stale");
  assert.equal(coverage(HEAD, HEAD, () => assert.fail(), undefined, () => assert.fail()), "exact");
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

test("没要求判定时，旧 FAIL 判定之后只改了规则文档照样拦", () => {
  const base = {
    head: HEAD,
    receipt: { sha: HEAD, level: "unit-test-verified" },
    judge: { sha: OLD, verdict: "FAIL" },
    need: "unit-test-verified",
    wantJudge: false,
    patchId: patchIds({ [OLD]: "p1", [HEAD]: "p1" }),
  };
  assert.equal(evaluate({ ...base, rulesChanged: () => false }).pass, false);
  assert.equal(evaluate({ ...base, rulesChanged: () => true }).pass, false);
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

test("check 只给 lyjw 的账号开的 PR 按 notes-only 沿用旧回执，别人的 PR 只改了注释也作废", async () => {
  const signed = "## 验证清单\n- V1：单测绿";
  const fetchAs = (user: { id: number }) => async (url: string) => {
    if (url.endsWith("/pulls/7")) return { ok: true, json: async () => ({ head: { sha: HEAD }, body: signed, user }) };
    return { ok: true, json: async () => [{ user: owner, body: stamp({ sha: OLD, level: "unit-test-verified", body: await bodyDigest(signed) }) }] };
  };
  const args = { pr: 7, need: "unit-test-verified", wantJudge: false };
  const deps = { patchId: patchIds({ [HEAD]: "p1", [OLD]: "p2" }), notesOnly: () => ["docs/a.md"], rulesChanged: () => false };
  const mine = await check(args, { ...deps, fetch: fetchAs(lyjw) });
  assert.equal(mine.receipt?.coverage, "notes-only");
  assert.equal(mine.pass, true);
  const theirs = await check(args, { ...deps, fetch: fetchAs({ id: 1 }) });
  assert.equal(theirs.receipt?.coverage, "stale");
  assert.equal(theirs.pass, false);
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

test("prTier：lyjw 的账号开的 PR 才去证明只改注释，证明的结果决定分档", () => {
  const pull = (id: number) => ({ number: 1, title: "t", state: "open", mergeable: true, head: { sha: "h" }, base: { ref: "main", sha: "b" }, user: { login: "x", id } });
  const asked: [string, string, string[]][] = [];
  const proven = (base: string, head: string, files: string[]) => (asked.push([base, head, files]), ["src/components/a.tsx"]);
  assert.equal(prTier(pull(153256373), ["src/components/a.tsx"], proven).name, "docs");
  assert.deepEqual(asked, [["b", "h", ["src/components/a.tsx"]]]);
  assert.equal(prTier(pull(153256373), ["src/components/a.tsx"], () => []).name, "ui");
  assert.equal(prTier(pull(1), ["src/components/a.tsx"], () => assert.fail()).name, "ui");
});
