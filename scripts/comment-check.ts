#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import type * as TS from "typescript";

import { loadTypeScript } from "./comment-only-check.ts";
import { COMMENT_CHECK as CHECK_NAME } from "./pr-gate/checks.ts";
import { TS_EXTENSIONS, collectTsComments, isTsDirective } from "./comment-only/typescript.ts";

const HELP = `用法：node scripts/comment-check.ts [--base <ref>] [--head <ref>] [--out <文件.json>] [--check-run <sha>]
      node scripts/comment-check.ts --post <文件.json> --pr <号>
让 TypeSafe Jev 逐条看 <base> 与 <head> 的合并基点以来新增的 JS / TS 注释，按根 AGENTS.md「文档与注释」判断该不该删。
结果是给写代码的线程的建议：自己逐条判断删还是留，不挡合并。
  --base       默认 origin/main
  --head       默认 HEAD，只看已提交的改动
  --out        把每条注释、Jev 的概率和结论写成 JSON，交给 --post
  --check-run  在这个提交上建 Check run「Comment check (Jev)」，有该删的或没问全（Jev 出错、少答、超出条数上限）时结论为 neutral，否则 success；要 GITHUB_TOKEN（checks: write）
  --post       读 --out 写下的 JSON，只发评论，不碰 git 和 Jev：问过至少一条注释时在 --pr 上以 lyjw131[bot] 发一条评论写结论，之后原地更新同一条；要 lyjw131 App 的 GITHUB_TOKEN（issues: write 与 pull-requests: write）
TYPESAFE_API_KEY 调 Jev（云端出口代理会自动带上）。退出码 0 跑完（含 Jev 调用失败，只在输出里写明）、1 发评论失败、2 参数或 git 出错。`;

export const JEV_MODEL = "jev-1.14.0";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
// 官方起步阈值是 0.7 / 0.3；在含线上漏报的标注集上 0.6 召回明显更高、精确率几乎不掉，所以 YES 取 0.6。
// [MAYBE, YES) 一档也列出来供参考，但不让结论变 neutral。改这几个值先用 scripts/comment-check-calibrate.ts 在标注集上比一遍
export const YES = 0.6;
export const MAYBE = 0.5;
export const NO = 0.3;
// 一次问的条数多了，相邻注释互相串味、误报明显变多；改它先用 scripts/comment-check-calibrate.ts 在标注集上比一遍
const QUESTIONS_PER_CALL = 10;
const MAX_COMMENTS = 200;
const CONTEXT_BEFORE = 2;
const CONTEXT_AFTER = 8;
const SKIP = [/(^|\/)node_modules\//, /\.d\.ts$/, /\.min\.js$/];

const RULE = `Comments are deleted by default; good names speak for themselves. Only three kinds may stay, and the test is "would deleting it make someone break the code":
1. Surprising behavior: a bug being worked around, a browser or runtime quirk, a race, a library pitfall.
2. Design intent: an invariant, a non-obvious constraint, a trade-off someone would want to "fix" (a deliberately chosen cache duration, cadence or threshold).
3. Contract: meaning and units of exported types and cross-service fields; a "keep in sync with X" that cannot be a test or shared constant.
Must be deleted: restating what the code does, translating identifiers into a sentence, mentioning callers or tasks / PRs / issues, section headers and separators, TODO / FIXME without a ticket, history or timeline ("previously", "changed to", "since", "this time"), copied volatile values (numbers, versions, dates) instead of a constant name, line-number references.
Comments may be in Chinese.`;

const CRITERIA = {
  true: "The comment restates the code, translates names, narrates history, mentions callers or tasks, is a section header, copies a volatile value, or otherwise falls outside the three allowed kinds.",
  false: "The comment records a surprising behavior, a design intent or constraint, or a contract that the code alone does not show; deleting it could lead someone to break the code.",
};

export type Found = { file: string; line: number; endLine: number; comment: string; code: string };
type Answer = { type: string; noul?: number };

function git(args: string[]) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} 失败：${result.stderr.trim()}`);
  return result.stdout;
}

export function addedLines(diff: string) {
  const added = new Map<string, Set<number>>();
  let file: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? null : line.slice(4).replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const set = added.get(file) ?? new Set<number>();
      for (let n = start; n < start + count; n += 1) set.add(n);
      added.set(file, set);
    }
  }
  return added;
}

export function basePaths(diff: string) {
  const paths = new Map<string, string>();
  let from: string | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ")) from = line === "--- /dev/null" ? null : line.slice(4).replace(/^a\//, "");
    else if (line.startsWith("+++ ") && from && line !== "+++ /dev/null") paths.set(line.slice(4).replace(/^b\//, ""), from);
  }
  return paths;
}

export function findComments(ts: typeof TS, file: string, text: string, added: Set<number>): Found[] {
  const kind = TS_EXTENSIONS.get(path.extname(file).toLowerCase());
  if (!kind) return [];
  const scriptKind = { TS: ts.ScriptKind.TS, TSX: ts.ScriptKind.TSX, JS: ts.ScriptKind.JS, JSX: ts.ScriptKind.JSX }[kind];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
  const lines = text.split("\n");
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const ranges = collectTsComments(ts, sf)
    .filter((range) => !isTsDirective(range.text, kind))
    .map((range) => {
      const at = sf.getLineAndCharacterOfPosition(range.start);
      return { ...range, first: at.line + 1, last: lineOf(Math.max(range.start, range.end - 1)), ownLine: !lines[at.line]?.slice(0, at.character).trim() };
    });
  // 连续几行的 // 是同一段话，合成一条再问，免得 Jev 只看见半句
  const blocks: (typeof ranges)[] = [];
  for (const range of ranges) {
    const prev = blocks.at(-1)?.at(-1);
    if (prev?.ownLine && range.ownLine && range.text.startsWith("//") && prev.text.startsWith("//") && range.first === prev.last + 1) blocks.at(-1)?.push(range);
    else blocks.push([range]);
  }
  return blocks
    .filter((block) => block.some((range) => Array.from({ length: range.last - range.first + 1 }, (_, i) => range.first + i).some((n) => added.has(n))))
    .map((block) => {
      const first = block[0]?.first ?? 1;
      const last = block.at(-1)?.last ?? first;
      return {
        file,
        line: first,
        endLine: last,
        comment: text.slice(block[0]?.start ?? 0, block.at(-1)?.end ?? 0),
        code: lines.slice(Math.max(0, first - 1 - CONTEXT_BEFORE), last + CONTEXT_AFTER).join("\n"),
      };
    });
}

export function collect(ts: typeof TS, base: string, head: string) {
  const from = git(["merge-base", base, head]).trim();
  const diff = git(["diff", "-U0", "--no-color", "--diff-filter=AMR", from, head]);
  const found: Found[] = [];
  const bases = basePaths(diff);
  for (const [file, added] of addedLines(diff)) {
    if (SKIP.some((re) => re.test(file)) || !TS_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    const base = bases.get(file);
    const before = base ? git(["show", `${from}:${base}`]) : "";
    const after = git(["show", `${head}:${file}`]);
    const every = (text: string) => findComments(ts, file, text, new Set(text.split("\n").map((_, i) => i + 1))).map((item) => item.comment.trim());
    // 只改了同一行代码时 diff 也把原样的尾注释算进新增行：同一段文字在 head 里比基准多出几处，才问几处
    const extra = new Map<string, number>();
    for (const text of every(after)) extra.set(text, (extra.get(text) ?? 0) + 1);
    for (const text of every(before)) extra.set(text, (extra.get(text) ?? 0) - 1);
    for (const item of findComments(ts, file, after, added)) {
      const left = extra.get(item.comment.trim()) ?? 0;
      if (left <= 0) continue;
      extra.set(item.comment.trim(), left - 1);
      found.push(item);
    }
  }
  return found;
}

export function buildRequests(found: Found[]) {
  const requests = [];
  for (let offset = 0; offset < found.length; offset += QUESTIONS_PER_CALL) {
    const chunk = found.slice(offset, offset + QUESTIONS_PER_CALL);
    const questions = Object.fromEntries(
      chunk.map((item, index) => [
        `c${offset + index}`,
        {
          type: "noul",
          instructions: `Under \`rule\`, should the comment \`comments[${index}].comment\` (shown inside \`comments[${index}].code\`) be deleted?`,
          criteria: CRITERIA,
        },
      ]),
    );
    requests.push({ model: JEV_MODEL, state: { rule: RULE, comments: chunk.map(({ file, comment, code }) => ({ file, comment, code })) }, questions });
  }
  return requests;
}

export async function ask(body: unknown, fetchImpl: typeof fetch = fetch) {
  const key = process.env.TYPESAFE_API_KEY;
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) return ((await response.json()) as { answers?: Record<string, Answer> }).answers ?? {};
    if (attempt >= 4 || ![429, 529].includes(response.status)) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
    await sleep(2 ** attempt * 1000);
  }
}

export type Scored = Found & { p: number | null };

export function report(scored: Scored[], { error, truncated }: { error?: string; truncated?: number } = {}) {
  const flagged = scored.filter((item) => (item.p ?? 0) >= YES).sort((a, b) => (b.p ?? 0) - (a.p ?? 0));
  const maybe = scored.filter((item) => item.p !== null && item.p >= MAYBE && item.p < YES).sort((a, b) => (b.p ?? 0) - (a.p ?? 0));
  const unsure = scored.filter((item) => item.p !== null && item.p > NO && item.p < MAYBE);
  const unanswered = scored.filter((item) => item.p === null).length;
  const gaps = [unanswered && `${unanswered} 条 Jev 没答`, truncated && `${truncated} 条超出上限没问`].filter(Boolean).join("，");
  const title = flagged.length ? `${flagged.length} 条新注释可能该删${gaps ? `（另有 ${gaps}）` : ""}` : error && !scored.some((item) => item.p !== null) ? "Jev 调用失败，没有建议" : gaps ? `没问全：${gaps}` : scored.length ? "新注释没有该删的" : "没有新增注释";
  const lines = [
    `给写代码的线程的建议，不挡合并：逐条对照根 AGENTS.md「文档与注释」自己判断删还是留。`,
    "",
    `新增注释 ${scored.length} 条${truncated ? `（另有 ${truncated} 条超出上限没问）` : ""}；Jev（${JEV_MODEL}）概率 ≥${YES} 的列为可能该删，${MAYBE}–${YES} 的列为拿不准，${NO}–${MAYBE} 之间的 ${unsure.length} 条不列。`,
  ];
  if (error) lines.push("", `调用失败：${error}`);
  const entry = (item: Scored) => ["", `- \`${item.file}:${item.line}\` ${item.p?.toFixed(2)}`, "", "  ```", ...item.comment.split("\n").map((text) => `  ${text}`), "  ```"];
  for (const item of flagged) lines.push(...entry(item));
  if (maybe.length) {
    lines.push("", `拿不准（${maybe.length} 条，看一眼即可）：`);
    for (const item of maybe) lines.push(...entry(item));
  }
  return { title, summary: lines.join("\n"), flagged, complete: !error && !truncated };
}

export const COMMENT_MARKER = "<!-- comment-check-jev -->";

const COMMENT_TEXT_LIMIT = 60_000;

export function commentBody(sha: string, text: string) {
  // 结论文字来自 PR 那边跑的脚本，转义掉 HTML 注释，免得借 lyjw131[bot] 的身份夹带 verify-stamp 一类机器读的标记
  const heading = text.replace(/^## /, "### ").replaceAll("<!--", "&lt;!--");
  const body = heading.length > COMMENT_TEXT_LIMIT ? `${heading.slice(0, COMMENT_TEXT_LIMIT)}\n\n…太长截断了，全部条目看这次运行上传的产物。` : heading;
  return `${COMMENT_MARKER}\n${body}\n\n<sub>按 ${sha.slice(0, 7)} 更新，每次推送原地改这一条。</sub>`;
}

export const COMMENT_AUTHOR = "lyjw131[bot]";

type IssueComment = { id: number; body?: string | null; user?: { login?: string } | null };

export type CommentResult = { sha: string; text: string; asked: boolean };

async function upsertComment(pr: number, body: string, { create }: { create: boolean }, fetchImpl: typeof fetch) {
  const repo = process.env.GITHUB_REPOSITORY ?? "LYJW131/lyjwpage";
  const api = `https://api.github.com/repos/${repo}`;
  const headers = { accept: "application/vnd.github+json", authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ""}`, "content-type": "application/json" };
  let existing: IssueComment | undefined;
  for (let page = 1; !existing; page += 1) {
    const response = await fetchImpl(`${api}/issues/${pr}/comments?per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`读 PR 评论失败：HTTP ${response.status}`);
    const batch = (await response.json()) as IssueComment[];
    existing = batch.find((item) => item.user?.login === COMMENT_AUTHOR && item.body?.startsWith(COMMENT_MARKER));
    if (batch.length < 100) break;
  }
  if (!existing && !create) return;
  const response = await fetchImpl(existing ? `${api}/issues/comments/${existing.id}` : `${api}/issues/${pr}/comments`, {
    method: existing ? "PATCH" : "POST",
    headers,
    body: JSON.stringify({ body }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`写 PR 评论失败：HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
}

async function publish(sha: string, result: ReturnType<typeof report>, fetchImpl: typeof fetch) {
  const repo = process.env.GITHUB_REPOSITORY ?? "LYJW131/lyjwpage";
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/check-runs`, {
    method: "POST",
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ""}`, "content-type": "application/json" },
    body: JSON.stringify({
      name: CHECK_NAME,
      head_sha: sha,
      status: "completed",
      conclusion: result.complete && !result.flagged.length ? "success" : "neutral",
      output: {
        title: result.title,
        summary: result.summary.slice(0, 65_000),
        annotations: result.flagged.slice(0, 50).map((item) => ({
          path: item.file,
          start_line: item.line,
          end_line: item.endLine,
          annotation_level: "notice",
          message: `Jev ${item.p?.toFixed(2)}：这条注释可能不属于可以留的三类（意外行为、设计意图、契约）`,
        })),
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`建 Check run 失败：HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
}

export async function main(argv: string[], fetchImpl: typeof fetch = fetch) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      base: { type: "string", default: "origin/main" },
      head: { type: "string", default: "HEAD" },
      out: { type: "string", default: "" },
      "check-run": { type: "string", default: "" },
      post: { type: "string", default: "" },
      pr: { type: "string", default: "" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.post) {
    const pr = Number(values.pr);
    if (!(Number.isInteger(pr) && pr > 0)) {
      console.error(`--post 要配正整数的 --pr，收到 ${values.pr || "空"}`);
      return 2;
    }
    const result = JSON.parse(fs.readFileSync(values.post, "utf8")) as Partial<CommentResult>;
    if (typeof result.sha !== "string" || typeof result.text !== "string" || typeof result.asked !== "boolean") {
      console.error(`${values.post} 里缺 sha、text 或 asked`);
      return 2;
    }
    // 这次没问到注释就不新开评论，已有的那条照样改成这次的结论，免得留着上一次的建议
    try {
      await upsertComment(pr, commentBody(result.sha, result.text), { create: result.asked }, fetchImpl);
    } catch (caught) {
      console.error((caught as Error).message);
      return 1;
    }
    return 0;
  }
  if (values.pr) {
    console.error("--pr 只配 --post 用");
    return 2;
  }
  const all = collect(loadTypeScript(process.cwd()), values.base, values.head);
  const found = all.slice(0, MAX_COMMENTS);
  let error: string | undefined;
  const scores = new Map<number, number>();
  try {
    const answers = await Promise.all(buildRequests(found).map((body) => ask(body, fetchImpl)));
    for (const batch of answers) for (const [key, answer] of Object.entries(batch)) if (typeof answer.noul === "number") scores.set(Number(key.slice(1)), answer.noul);
    if (scores.size < found.length) error = `Jev 只答了 ${scores.size} / ${found.length} 条`;
  } catch (caught) {
    error = (caught as Error).message;
  }
  const scored: Scored[] = found.map((item, index) => ({ ...item, p: scores.get(index) ?? null }));
  const result = report(scored, { error, truncated: all.length - found.length });
  const text = `## ${CHECK_NAME}：${result.title}\n\n${result.summary}`;
  const sha = values["check-run"] || git(["rev-parse", values.head]).trim();
  if (values.out) fs.writeFileSync(values.out, JSON.stringify({ model: JEV_MODEL, error, sha, text, asked: found.length > 0, comments: scored }, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  console.log(text);
  if (values["check-run"]) {
    try {
      await publish(values["check-run"], result, fetchImpl);
    } catch (caught) {
      console.error((caught as Error).message);
    }
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
  }
}
