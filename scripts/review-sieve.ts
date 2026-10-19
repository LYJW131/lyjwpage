#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO = "LYJW131/lyjwpage";
const REQUEST_TIMEOUT_MS = 30_000;
const CONCURRENCY = 6;
// 上限要高过一天合并的 PR 数，取少了积压只增不减。
const DEFAULT_LIMIT = 70;
const SUGGESTION_CHARS = 60;
const REPLY_CHARS = 80;

// PR 一方的回复由 lyjw 的两个账号发，按数字 id 认；须与 scripts/verify-receipt.ts#TRUSTED_AUTHOR_IDS 一致，由测试核对。
export const TRUSTED_AUTHOR_IDS = new Set([153256373, 300701323]);
// 登录名去掉 [bot] 后缀再比：不同接口返回的写法不一样。
export const BOTS: Record<string, string> = { "chatgpt-codex-connector": "codex", "devin-ai-integration": "devin" };

const HELP = `用法：NODE_USE_ENV_PROXY=1 node scripts/review-sieve.ts --last-merged-at <ISO> --last-number <号> [--limit <N>]

提炼例程第 4b 步：列出书签之后合并进 main 的 PR，取 Codex、Devin 的评审建议和 lyjw 账号的回复，
按 .claude/skills/lyjwpage-skill-mining/review-mining.md 的采纳规则分成 adopted / uncertain / notAdopted 三堆。
只读，不写状态文件。输出 JSON；退出码 0 全部读到、1 有 PR 没读到或列不出 PR、2 参数错。

选项：
  --last-merged-at <ISO>  书签 prs.lastMergedAt（必填）
  --last-number <号>      书签 prs.lastNumber（必填；没有书签时按 review-mining.md 定起点，号写 0）
  --limit <N>             一次最多读几个 PR，默认 ${DEFAULT_LIMIT}，其余记在 backlog
  --help                  显示本说明

输出的 bookmark 停在第一个没读到的 PR 之前；例程把结果写进状态文件后，才把它写回 prs。`;

type User = { login?: string; id?: number } | null;
type ReviewComment = {
  id: number;
  in_reply_to_id?: number | null;
  user?: User;
  body?: string | null;
  path?: string | null;
  line?: number | null;
  original_line?: number | null;
  created_at: string;
  html_url: string;
};
type IssueComment = { id: number; user?: User; body?: string | null; created_at: string; html_url: string };
type Review = { id: number; user?: User; body?: string | null; submitted_at?: string | null; html_url: string };
type Commit = { sha: string; parents?: unknown[]; commit: { message: string; committer?: { date?: string } | null } };
type Pull = { number: number; merged_at: string | null; updated_at: string; title: string };

export type Bookmark = { lastMergedAt: string; lastNumber: number };
export type Reply = { body: string; at: string; url: string };
export type PrCommit = { sha: string; at: string; subject: string; merge: boolean };
export type Verdict = "adopted" | "uncertain" | "notAdopted";
export type Item = {
  pr: number;
  bot: string;
  severity: string | null;
  path: string | null;
  line: number | null;
  url: string;
  suggestion: string;
  reply: string | null;
  evidence: string;
  candidate?: string;
};
export type PrData = { comments: ReviewComment[]; issueComments: IssueComment[]; reviews: Review[]; commits: Commit[] };

type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
}>;

const NOT_ADOPTED = [
  /不改(?![变动善进])/,
  /(?:不用|无需|不需要|不必)改/,
  /不在(?:本|这个|此)\s*PR/,
  /(?:保持|保留|维持)现状/,
  /有意(?:如此|为之|这样|的取舍)/,
  /复现不出|无法复现|没能复现/,
  /不成立|不属实|不采纳/,
  /拆到\s*#\d+/,
  /另开|单独开/,
  /won't fix|not (?:going to )?fix|by design|intentional/i,
];
const ADOPTED = [
  /成立/,
  /属实/,
  /说得对/,
  /^对[，,：:]/,
  /采纳|确实/,
  /已(?:修|改|补|加|删|撤|换|去掉|同步|更新|处理)/,
  /下(?:一个?|个|次)(?:代码)?(?:提交|推送)/,
  /\b(?:fixed|addressed|done)\b|good catch/i,
];
const FUTURE = /下(?:一个?|个|次)|尚未推送|待推送|即将推送|随后推送|稍后/;
const SUMMARY = [
  /^#{2,3}\s*💡\s*Codex Review\b/,
  /^## Codex Review Summary/,
  /^Codex Review: /,
  /Codex usage limits/,
  /^\*\*Devin Review\*\* found \d+ potential issues?\./,
  /^## ✅ Devin Review: No Issues Found/,
];
const BOOKKEEPING = /^(?:验证回执|判定) [0-9a-f]{40}|^@codex\b/;
const SHA_TOKEN = /(?<![0-9a-z])[0-9a-f]{7,40}(?![0-9a-z])/gi;

export function plain(body: string) {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<details>[\s\S]*?<\/details>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^\s*---\s*$[\s\S]*/m, "")
    .replace(/^_.*(?:Generated|Addressed) by .*_\s*$/gm, "")
    .trim();
}

function clip(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function firstSentence(text: string, max: number) {
  const end = text.search(/[。！？\n]|\.\s/);
  return clip(end === -1 ? text : text.slice(0, end + 1), max);
}

function suggestionTitle(text: string) {
  const bold = /\*\*\s*([^*]+?)\s*\*\*/.exec(text);
  return bold ? clip(bold[1], SUGGESTION_CHARS) : firstSentence(text, SUGGESTION_CHARS);
}

export function severity(body: string) {
  const badge = /!\[(P\d) Badge\]/.exec(body);
  if (badge) return badge[1];
  const mark = /^\s*(\P{ASCII}{1,4})\s*\*\*/u.exec(plain(body))?.[1];
  const kind = /"kind":\s*"(\w+)"/.exec(body)?.[1];
  return [mark, kind].filter(Boolean).join(" ") || null;
}

export function botOf(user: User | undefined) {
  return BOTS[(user?.login ?? "").replace(/\[bot\]$/, "")] ?? null;
}

const trusted = (user: User | undefined) => TRUSTED_AUTHOR_IDS.has(user?.id ?? 0);
const firstMatch = (patterns: RegExp[], text: string) => patterns.map((re) => re.exec(text)?.[0]).find(Boolean) ?? null;
const later = (a: string, b: string) => Date.parse(a) > Date.parse(b);

export function shaHits(text: string, commits: PrCommit[]) {
  const tokens = [...new Set((text.match(SHA_TOKEN) ?? []).map((t) => t.toLowerCase()))];
  const hits: string[] = [];
  const misses: string[] = [];
  for (const token of tokens) {
    const commit = commits.find((c) => c.sha.toLowerCase().startsWith(token));
    if (commit) hits.push(token);
    else if (/[a-f]/.test(token) && /\d/.test(token)) misses.push(token);
  }
  return { hits, misses };
}

// 「下一个提交修」的修复在回复之后；「已修」不写 SHA 时，常是先提交、再回复、最后推送，修复在回复之前。
function candidateCommit(reply: { at: string; text: string }, commits: PrCommit[]) {
  const own = commits.filter((c) => !c.merge).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const next = own.find((c) => later(c.at, reply.at));
  const previous = own.filter((c) => !later(c.at, reply.at)).at(-1);
  const pick = FUTURE.test(reply.text) ? (next ?? previous) : (previous ?? next);
  return pick ? `${pick.sha.slice(0, 7)} ${clip(pick.subject, 60)}` : "本 PR 没有提交";
}

export function classify(suggestionAt: string, replies: Reply[], general: Reply[], commits: PrCommit[]) {
  const texts = replies
    .map((r) => ({ ...r, text: plain(r.body) }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const all = shaHits(texts.map((t) => t.text).join("\n"), commits);
  if (all.hits.length) {
    const holder = texts.findLast((t) => shaHits(t.text, commits).hits.length)!;
    const refusal = texts.map((t) => firstMatch(NOT_ADOPTED, t.text)).find(Boolean);
    return refusal
      ? { verdict: "uncertain" as const, evidence: `${all.hits.join(" ")} 在本 PR 提交里，但回复也说「${refusal}」`, reply: holder }
      : { verdict: "adopted" as const, evidence: all.hits.join(" "), reply: holder };
  }
  const unmatched = all.misses.length ? `；${all.misses.join(" ")} 不在本 PR 提交里` : "";
  for (const t of [...texts].reverse()) {
    const refusal = firstMatch(NOT_ADOPTED, t.text);
    if (refusal) return { verdict: "notAdopted" as const, evidence: `「${refusal}」`, reply: t };
    const accept = firstMatch(ADOPTED, t.text);
    if (accept) {
      return { verdict: "uncertain" as const, evidence: `「${accept}」，没写本 PR 里的 SHA${unmatched}`, reply: t, candidate: candidateCommit(t, commits) };
    }
  }
  if (texts.length) {
    const last = texts.at(-1)!;
    return { verdict: "uncertain" as const, evidence: `回复没命中关键词${unmatched}`, reply: last, candidate: candidateCommit(last, commits) };
  }
  const after = general.filter((g) => later(g.at, suggestionAt));
  if (after.length) {
    const { hits } = shaHits(after.map((g) => plain(g.body)).join("\n"), commits);
    return {
      verdict: "uncertain" as const,
      evidence: `没有行内回复，之后有普通评论 ${after.map((g) => g.url).join(" ")}${hits.length ? `（含 ${hits.join(" ")}）` : ""}`,
      reply: after[0],
    };
  }
  return { verdict: "notAdopted" as const, evidence: "没有回复", reply: null };
}

export function sievePr(pr: number, data: PrData) {
  const commits: PrCommit[] = data.commits.map((c) => ({
    sha: c.sha,
    at: c.commit.committer?.date ?? "",
    subject: c.commit.message.split("\n", 1)[0],
    merge: (c.parents?.length ?? 1) > 1,
  }));
  const general: Reply[] = [
    ...data.issueComments.filter((c) => trusted(c.user)).map((c) => ({ body: c.body ?? "", at: c.created_at, url: c.html_url })),
    ...data.reviews.filter((r) => trusted(r.user) && r.submitted_at).map((r) => ({ body: r.body ?? "", at: r.submitted_at!, url: r.html_url })),
  ].filter((r) => plain(r.body) && !BOOKKEEPING.test(plain(r.body)));
  const items: (Item & { verdict: Verdict })[] = [];

  for (const root of data.comments) {
    const bot = botOf(root.user);
    if (root.in_reply_to_id || !bot) continue;
    const replies = data.comments
      .filter((c) => c.in_reply_to_id === root.id && trusted(c.user))
      .map((c) => ({ body: c.body ?? "", at: c.created_at, url: c.html_url }));
    const result = classify(root.created_at, replies, general, commits);
    items.push({
      pr,
      bot,
      severity: severity(root.body ?? ""),
      path: root.path ?? null,
      line: root.line ?? root.original_line ?? null,
      url: root.html_url,
      suggestion: suggestionTitle(plain(root.body ?? "")),
      reply: result.reply ? firstSentence(plain(result.reply.body), REPLY_CHARS) : null,
      evidence: result.evidence,
      ...("candidate" in result && result.candidate ? { candidate: result.candidate } : {}),
      verdict: result.verdict,
    });
  }

  const bodies = [
    ...data.reviews.map((r) => ({ user: r.user, body: r.body ?? "", url: r.html_url })),
    ...data.issueComments.map((c) => ({ user: c.user, body: c.body ?? "", url: c.html_url })),
  ];
  for (const { user, body, url } of bodies) {
    const bot = botOf(user);
    const text = plain(body);
    if (!bot || !text) continue;
    if (!/!\[P\d Badge\]/.test(body) && SUMMARY.some((re) => re.test(text))) continue;
    items.push({
      pr,
      bot,
      severity: severity(body),
      path: null,
      line: null,
      url,
      suggestion: suggestionTitle(text),
      reply: null,
      evidence: "非行内建议，脚本不判",
      verdict: "uncertain",
    });
  }
  return items;
}

async function github(path: string, fetchImpl: FetchLike): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${path.split("?")[0]} HTTP ${response.status}`);
  return response.json();
}

async function allPages<T>(path: string, fetchImpl: FetchLike) {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const batch = (await github(`${path}?per_page=100&page=${page}`, fetchImpl)) as T[];
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

const mergedAfter = (pull: Pull, mark: Bookmark) => {
  const merged = Date.parse(pull.merged_at!);
  const since = Date.parse(mark.lastMergedAt);
  return merged > since || (merged === since && pull.number > mark.lastNumber);
};

export async function listMerged(mark: Bookmark, fetchImpl: FetchLike) {
  const found = new Map<number, Pull>();
  // 按更新时间倒序翻页：合并会更新 PR，所以书签之后合并的 PR 更新时间都不早于书签，翻到更早的就停。
  for (let page = 1; ; page += 1) {
    const batch = (await github(`pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=${page}`, fetchImpl)) as Pull[];
    for (const pull of batch) if (pull.merged_at && mergedAfter(pull, mark)) found.set(pull.number, pull);
    if (batch.length < 100 || Date.parse(batch.at(-1)!.updated_at) < Date.parse(mark.lastMergedAt)) break;
  }
  return [...found.values()].sort((a, b) => Date.parse(a.merged_at!) - Date.parse(b.merged_at!) || a.number - b.number);
}

async function readPr(pr: number, fetchImpl: FetchLike): Promise<PrData> {
  const [comments, issueComments, reviews, commits] = await Promise.all([
    allPages<ReviewComment>(`pulls/${pr}/comments`, fetchImpl),
    allPages<IssueComment>(`issues/${pr}/comments`, fetchImpl),
    allPages<Review>(`pulls/${pr}/reviews`, fetchImpl),
    allPages<Commit>(`pulls/${pr}/commits`, fetchImpl),
  ]);
  return { comments, issueComments, reviews, commits };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function sieve({ bookmark, limit }: { bookmark: Bookmark; limit: number }, deps: { fetch?: FetchLike } = {}) {
  const fetchImpl: FetchLike = deps.fetch ?? fetch;
  const result = {
    from: bookmark,
    bookmark,
    read: [] as number[],
    backlog: 0,
    failed: [] as { pr: number | null; error: string }[],
    counts: { adopted: 0, uncertain: 0, notAdopted: 0 },
    adopted: [] as Item[],
    uncertain: [] as Item[],
    notAdopted: [] as Item[],
  };
  let pulls: Pull[];
  try {
    pulls = await listMerged(bookmark, fetchImpl);
  } catch (error) {
    result.failed.push({ pr: null, error: `列不出合并的 PR（${(error as Error).message}）` });
    return result;
  }
  const batch = pulls.slice(0, limit);
  result.backlog = pulls.length - batch.length;
  const outcomes = await mapLimit(batch, CONCURRENCY, async (pull) => {
    try {
      return { pull, items: sievePr(pull.number, await readPr(pull.number, fetchImpl)) };
    } catch (error) {
      return { pull, error: (error as Error).message };
    }
  });
  let advancing = true;
  for (const outcome of outcomes) {
    if ("error" in outcome) {
      result.failed.push({ pr: outcome.pull.number, error: outcome.error ?? "" });
      advancing = false;
      continue;
    }
    result.read.push(outcome.pull.number);
    if (advancing) result.bookmark = { lastMergedAt: outcome.pull.merged_at!, lastNumber: outcome.pull.number };
    for (const { verdict, ...item } of outcome.items) {
      result[verdict].push(item);
      result.counts[verdict] += 1;
    }
  }
  return result;
}

async function main() {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        "last-merged-at": { type: "string" },
        "last-number": { type: "string" },
        limit: { type: "string" },
        help: { type: "boolean" },
      },
      strict: true,
    }));
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const lastMergedAt = String(values["last-merged-at"] ?? "");
  const lastNumber = Number(values["last-number"]);
  const limit = values.limit === undefined ? DEFAULT_LIMIT : Number(values.limit);
  if (Number.isNaN(Date.parse(lastMergedAt)) || !Number.isInteger(lastNumber) || lastNumber < 0 || !Number.isInteger(limit) || limit <= 0) {
    console.error(`需要 --last-merged-at <ISO> 与 --last-number <非负整数>，--limit 是正整数\n\n${HELP}`);
    return 2;
  }
  const result = await sieve({ bookmark: { lastMergedAt, lastNumber }, limit });
  console.log(JSON.stringify(result, null, 2));
  return result.failed.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
