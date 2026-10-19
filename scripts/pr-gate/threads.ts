import { TRUSTED_AUTHOR_IDS } from "../verify-receipt.ts";
import type { Client, ReviewComment } from "./github.ts";
import { REPO } from "./github.ts";
import { BOTS } from "./reviewers.ts";

export type Level = "blocking" | "security" | "normal" | "optional" | "pre-existing" | "info" | "unmarked";
export type Resolution = { source: "graphql" | "ccr" | "rest"; byRoot: Map<number, { resolved: boolean; outdated: boolean }> | null };

function firstLine(body: string) {
  return body.replace(/<!--[\s\S]*?-->/g, "").trim().split("\n", 1)[0] ?? "";
}

// 各家标记：Codex 是 P0–P3 徽章；Claude review 是 🔴 / 🟡 nit / 🟣 既有问题；Devin 是 🔴 / 🟡 bug、🟥 / 🟨 security、🔍 / 📝 说明，
// 种类写在开头的 HTML 注释里。红圈永不算可选，所以先认 🔴，再看「(optional)」之类的字样。
export function severityOf(body: string, bot: string | null): { mark: string | null; level: Level } {
  const devinKind = /"kind":\s*"(\w+)"/.exec(body)?.[1] ?? null;
  const head = firstLine(body);
  const badge = /!\[(P[0-3]) Badge\]/.exec(head)?.[1];
  if (badge) return { mark: badge, level: badge === "P0" || badge === "P1" ? "blocking" : badge === "P2" ? "normal" : "optional" };
  const emoji = /🔴|🟥|🟨|🟣|🟡|🔍|📝/u.exec(head)?.[0] ?? null;
  if (devinKind === "security" || emoji === "🟥" || emoji === "🟨") return { mark: emoji ?? "security", level: "security" };
  if (emoji === "🔴") return { mark: emoji, level: "blocking" };
  if (emoji === "🟣") return { mark: emoji, level: "pre-existing" };
  if (emoji === "🟡") return { mark: emoji, level: bot === "claude" || /\(optional\)|\bnit\b/i.test(head) ? "optional" : "normal" };
  if (emoji) return { mark: emoji, level: "info" };
  const label = /\b(blocker|critical|high|security|nit|minor|optional)\b/i.exec(head)?.[1]?.toLowerCase();
  if (!label) return { mark: null, level: "unmarked" };
  if (label === "security") return { mark: label, level: "security" };
  return { mark: label, level: ["nit", "minor", "optional"].includes(label) ? "optional" : "blocking" };
}

function shortTitle(body: string) {
  const text = firstLine(body)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*/g, "")
    .trim();
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

export function buildThreads(comments: ReviewComment[], resolution: Resolution) {
  const byRoot = new Map<number, ReviewComment[]>();
  const ordered = [...comments].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id - b.id);
  for (const comment of ordered) {
    const root = comment.in_reply_to_id ?? comment.id;
    const thread = byRoot.get(root) ?? [];
    thread.push(comment);
    byRoot.set(root, thread);
  }
  const unresolved = [];
  for (const [root, thread] of byRoot) {
    const state = resolution.byRoot?.get(root) ?? null;
    if (state?.resolved) continue;
    const first = thread[0];
    const last = thread[thread.length - 1];
    unresolved.push({
      by: first.user?.login ?? null,
      ...severityOf(first.body ?? "", BOTS[first.user?.login ?? ""] ?? null),
      title: shortTitle(first.body ?? ""),
      lastBy: last.user?.login ?? null,
      lastByLyjw: TRUSTED_AUTHOR_IDS.has(last.user?.id ?? 0),
      outdated: state?.outdated ?? null,
      path: first.path ?? null,
      line: first.line ?? first.original_line ?? null,
      url: first.html_url ?? null,
    });
  }
  return { source: resolution.source, resolvedKnown: resolution.byRoot !== null, total: byRoot.size, unresolved };
}

export async function threadResolution(gh: Client, pr: number): Promise<Resolution> {
  try {
    const query = `query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){
      reviewThreads(first:100){nodes{isResolved isOutdated comments(first:1){nodes{databaseId}}}}}}}`;
    const [owner, name] = REPO.split("/");
    const result = (await gh.graphql(query, { owner, name, pr })) as {
      data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: { isResolved: boolean; isOutdated: boolean; comments: { nodes: { databaseId: number }[] } }[] } } } };
    };
    const nodes = result.data?.repository?.pullRequest?.reviewThreads?.nodes;
    if (!nodes) throw new Error("graphql 没有 reviewThreads");
    const byRoot = new Map(nodes.map((node) => [node.comments.nodes[0]?.databaseId ?? 0, { resolved: node.isResolved, outdated: node.isOutdated }]));
    return { source: "graphql", byRoot };
  } catch {}
  // Claude Code 会话拦 GraphQL，给了这条只读路由代替；会话外它不存在。
  try {
    const threads = await gh.get<{ resolved: boolean; outdated: boolean; comment_ids: number[] }[]>(`pulls/${pr}/ccr/review_threads`);
    const byRoot = new Map(threads.map((thread) => [Math.min(...thread.comment_ids), { resolved: thread.resolved, outdated: thread.outdated }]));
    return { source: "ccr", byRoot };
  } catch {}
  return { source: "rest", byRoot: null };
}
