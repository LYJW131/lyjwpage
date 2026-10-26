import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const FETCH = path.resolve(".claude/skills/lyjwpage-anthropic-updates/fetch.py");
const ACCOUNTS = ["AnthropicAI", "claudeai", "ClaudeDevs", "bcherny", "_catwu", "trq212", "alexalbert__", "felixrieseberg", "poteto", "mattpocockuk", "karpathy", "HamelHusain"];

type Page = { items: { id: string; author?: string }[]; next?: string | null; stop?: boolean };

function run(cursors: Record<string, unknown>, pages: Record<string, Page[]>, errors: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "x-ingest-"));
  const x = path.join(dir, "x");
  mkdirSync(x);
  writeFileSync(path.join(dir, "state.json"), JSON.stringify({ cursors, ledger: [] }));
  writeFileSync(path.join(dir, "pending.json"), JSON.stringify({ seen: {}, cursors: {}, xPlannedAt: "2026-10-26T00:00:00Z" }));
  const all: Record<string, Page[]> = { "x-likes": [{ items: [], stop: true }], "x-bookmarks": [{ items: [], stop: true }] };
  for (const name of ACCOUNTS) all[name] = [{ items: [] }];
  for (const [name, list] of Object.entries({ ...all, ...pages })) {
    list.forEach((p, i) => writeFileSync(path.join(x, `${name}.${i + 1}.json`), JSON.stringify(p)));
  }
  for (const [name, msg] of Object.entries(errors)) writeFileSync(path.join(x, `${name}.error.txt`), msg);
  const env = { ...process.env, ANTHROPIC_UPDATES_DIR: dir };
  const report = JSON.parse(execFileSync("python3", ["-I", FETCH, "x-ingest", x], { env, encoding: "utf8" }));
  const pending = JSON.parse(readFileSync(path.join(dir, "pending.json"), "utf8")).cursors;
  return { report, pending };
}

const tweet = (id: string, author = "a") => ({ id, author });

test("账号读失败或分页没读完时书签不动，读完的照常推进", () => {
  const { report, pending } = run(
    { x: { AnthropicAI: "100", claudeai: "200", bcherny: "50" } },
    {
      AnthropicAI: [{ items: [tweet("120"), tweet("110")], next: null }],
      bcherny: [{ items: [tweet("60")], next: "p2" }],
    },
    { claudeai: "HTTP 500" },
  );
  assert.equal(pending.x.AnthropicAI, "120");
  assert.equal(pending.x.claudeai, "200");
  assert.equal(pending.x.bcherny, "50");
  assert.deepEqual(Object.keys(report.x.failedAccounts).sort(), ["bcherny", "claudeai"]);
});

test("点赞碰到已知 id 就停，新 id 排在书签前面；没读完的点赞算失败", () => {
  const done = run({ x: {}, "x-likes": ["L5", "L4"] }, { "x-likes": [{ items: [tweet("L7"), tweet("L6")], next: null, stop: true }] });
  assert.deepEqual(done.pending["x-likes"], ["L7", "L6", "L5", "L4"]);
  assert.equal(done.report["x-likes"].new.length, 2);

  const partial = run({ x: {}, "x-likes": ["L5"] }, { "x-likes": [{ items: [tweet("L9")], next: "p2" }] });
  assert.equal(partial.report["x-likes"].ok, false);
  assert.equal(partial.pending["x-likes"], undefined);
});

test("收藏首次只报第一页并标 firstRun；翻满上限没碰到已知 id 标 cursorLost", () => {
  const first = run({ x: {} }, { "x-bookmarks": [{ items: [tweet("B2"), tweet("B1")], next: "p2", stop: true }] });
  assert.equal(first.report["x-bookmarks"].firstRun, true);
  assert.deepEqual(first.pending["x-bookmarks"], ["B2", "B1"]);

  const lost = run({ x: {}, "x-bookmarks": ["K"] }, { "x-bookmarks": Array.from({ length: 5 }, (_, i) => ({ items: [tweet(`Z${i}`)], next: "more" })) });
  assert.equal(lost.report["x-bookmarks"].cursorLost, true);
});

test("时间线翻满上限仍有下一页时推进书签并标 truncatedAccounts", () => {
  const plan = JSON.parse(execFileSync("python3", ["-I", FETCH, "x-plan"], {
    env: { ...process.env, ANTHROPIC_UPDATES_DIR: (() => { const d = mkdtempSync(path.join(tmpdir(), "x-plan-")); writeFileSync(path.join(d, "state.json"), JSON.stringify({ cursors: { x: {} } })); return d; })() },
    encoding: "utf8",
  }));
  const max = plan.find((c: { file: string }) => c.file === "AnthropicAI").maxPages;
  const { report, pending } = run({ x: { AnthropicAI: "1" } }, { AnthropicAI: Array.from({ length: max }, (_, i) => ({ items: [tweet(String(100 + i))], next: "more" })) });
  assert.deepEqual(report.x.truncatedAccounts, ["AnthropicAI"]);
  assert.equal(pending.x.AnthropicAI, String(100 + max - 1));
});

test("新账号这段时间没发帖时记下扫描时刻，下一轮从这个时刻接着读", () => {
  const { pending } = run({ x: { AnthropicAI: "100" } }, {});
  assert.equal(pending.x.claudeai, "t:2026-10-26T00:00:00Z");
  assert.equal(pending.x.AnthropicAI, "100");

  const dir = mkdtempSync(path.join(tmpdir(), "x-plan-"));
  writeFileSync(path.join(dir, "state.json"), JSON.stringify({ cursors: { x: pending.x } }));
  const plan = JSON.parse(execFileSync("python3", ["-I", FETCH, "x-plan"], { env: { ...process.env, ANTHROPIC_UPDATES_DIR: dir }, encoding: "utf8" }));
  assert.match(plan.find((c: { file: string }) => c.file === "claudeai").code, /"start_time": "2026-10-26T00:00:00Z"/);
});
