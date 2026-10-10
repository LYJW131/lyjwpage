import type Anthropic from "@anthropic-ai/sdk";

import { site } from "@/lib/site";

import { BUILD_REPO } from "@shared/build-routine";

import { GITHUB_API, GITHUB_API_HEADERS } from "../build/github-oauth";
import type { ReadDoc } from "../tools/project-docs";

// 只给设计会话：规划者要看到真实代码才能列准路径。仓库本来公开，读的是 main 上的原文件。
export const REPO_FILE_LIMITS = { chars: 12_000, readsPerReply: 12, pathChars: 240, findsPerReply: 10, findResults: 40, queryChars: 80 } as const;
// 文件树按 isolate 缓存：规划者一条回复会查好几次，没登录的 GitHub API 每小时 60 次，按 IP 算。
const REPO_TREE_TTL_MS = 5 * 60_000;

export const READ_REPO_FILE_TOOL: Anthropic.Beta.BetaTool = {
  name: "read_repo_file",
  description: `Read a source file from this site's public repository (main branch) to see the real code before planning. path is repository-relative, such as workers/ai/src/tools/site-status.ts. Lines come back numbered; a long file is cut at about ${REPO_FILE_LIMITS.chars} characters with the line to continue from, so call again with startLine. Each reply may read at most ${REPO_FILE_LIMITS.readsPerReply} files or ranges.`,
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repository-relative file path" },
      startLine: { type: "integer", description: "First line to return, 1-based; omit to start at the top" },
      endLine: { type: "integer", description: "Last line to return; omit to read as far as the size limit allows" },
    },
    required: ["path"],
    additionalProperties: false,
  },
};

export const FIND_REPO_FILES_TOOL: Anthropic.Beta.BetaTool = {
  name: "find_repo_files",
  description: `Find file paths in this site's public repository (main branch) before reading them; never guess a path. query is one or more space-separated fragments that must all appear in the path, case-insensitive, such as "plan card", "github sign", or "workers/ai chat". Returns at most ${REPO_FILE_LIMITS.findResults} paths. Each reply may search at most ${REPO_FILE_LIMITS.findsPerReply} times.`,
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "Space-separated path fragments" } },
    required: ["query"],
    additionalProperties: false,
  },
};

export type RepoTree = () => Promise<string[] | null>;

let treeCache: { at: number; paths: string[] } | undefined;

export function repoTree(fetcher: typeof fetch = fetch): RepoTree {
  return async () => {
    if (treeCache && Date.now() - treeCache.at < REPO_TREE_TTL_MS) return treeCache.paths;
    try {
      const response = await fetcher(`${GITHUB_API}/repos/${BUILD_REPO}/git/trees/main?recursive=1`, { headers: GITHUB_API_HEADERS, signal: AbortSignal.timeout(10_000), cf: { cacheTtl: REPO_TREE_TTL_MS / 1000, cacheEverything: true } });
      if (!response.ok) return treeCache?.paths ?? null;
      const data = await response.json() as { tree?: { path?: unknown; type?: unknown }[] };
      const paths = (data.tree ?? []).flatMap((entry) => entry.type === "blob" && typeof entry.path === "string" ? [entry.path] : []);
      if (!paths.length) return treeCache?.paths ?? null;
      treeCache = { at: Date.now(), paths };
      return paths;
    } catch {
      return treeCache?.paths ?? null;
    }
  };
}

export function parseFindInput(input: unknown): string[] | null {
  const query = (input as { query?: unknown } | null)?.query;
  if (typeof query !== "string") return null;
  const terms = query.trim().toLowerCase().slice(0, REPO_FILE_LIMITS.queryChars).split(/\s+/).filter(Boolean);
  return terms.length ? terms : null;
}

export async function findRepoFiles(tree: RepoTree, terms: string[]): Promise<{ ok: boolean; text: string }> {
  const paths = await tree();
  if (!paths) return { ok: false, text: JSON.stringify({ error: "The repository file list is unavailable right now." }) };
  const hits = paths.filter((path) => { const lower = path.toLowerCase(); return terms.every((term) => lower.includes(term)); })
    .sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (!hits.length) return { ok: true, text: `No paths contain all of: ${terms.join(" ")}. Try fewer or shorter fragments.` };
  const shown = hits.slice(0, REPO_FILE_LIMITS.findResults);
  return { ok: true, text: `${shown.join("\n")}${hits.length > shown.length ? `\n[${hits.length - shown.length} more; add a fragment to narrow it down.]` : ""}` };
}

async function similarPaths(tree: RepoTree | undefined, path: string): Promise<string[]> {
  const paths = tree && await tree();
  if (!paths) return [];
  const name = path.split("/").at(-1)!.toLowerCase();
  const stem = name.replace(/\.[^.]+$/, "");
  const same = paths.filter((candidate) => candidate.toLowerCase().endsWith(`/${name}`) || candidate.toLowerCase() === name);
  return (same.length ? same : stem.length >= 4 ? paths.filter((candidate) => candidate.split("/").at(-1)!.toLowerCase().includes(stem)) : []).slice(0, 8);
}

export type RepoFileRequest = { path: string; startLine: number; endLine?: number };

export function parseRepoFileInput(input: unknown): RepoFileRequest | null {
  const { path, startLine, endLine } = (input ?? {}) as Record<string, unknown>;
  if (typeof path !== "string") return null;
  const clean = path.trim().replace(/^\.?\//, "");
  if (!clean || clean.length > REPO_FILE_LIMITS.pathChars || !/^[\w.@()[\] /-]+$/.test(clean) || clean.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const start = Number.isInteger(startLine) && (startLine as number) > 0 ? startLine as number : 1;
  const end = Number.isInteger(endLine) && (endLine as number) >= start ? endLine as number : undefined;
  return { path: clean, startLine: start, ...(end && { endLine: end }) };
}

export function repoFileUrl(path: string, kind: "blob" | "raw"): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return kind === "blob" ? `${site.repo}/blob/main/${encoded}` : `${site.repo.replace("https://github.com/", "https://raw.githubusercontent.com/")}/main/${encoded}`;
}

export async function readRepoFile(read: ReadDoc, request: RepoFileRequest, tree?: RepoTree): Promise<{ ok: boolean; text: string }> {
  const header = `Source: ${repoFileUrl(request.path, "blob")}`;
  try {
    const response = await read(repoFileUrl(request.path, "raw"));
    if (response.status === 404) {
      const similar = await similarPaths(tree, request.path);
      return { ok: false, text: `${header}\n\nNo such file on main.${similar.length ? ` Similar paths:\n${similar.join("\n")}` : " Use find_repo_files to locate it."}` };
    }
    if (!response.ok) return { ok: false, text: `${header}\n\n${JSON.stringify({ error: `HTTP ${response.status}` })}` };
    const lines = (await response.text()).split("\n");
    const last = Math.min(request.endLine ?? lines.length, lines.length);
    const out: string[] = [];
    let size = 0;
    let line = request.startLine;
    for (; line <= last; line += 1) {
      const entry = `${line}: ${lines[line - 1]}`;
      if (size + entry.length > REPO_FILE_LIMITS.chars && out.length) break;
      out.push(entry);
      size += entry.length + 1;
    }
    const range = `Lines ${request.startLine}-${line - 1} of ${lines.length}`;
    const more = line <= last ? `\n[Cut for length. Call again with startLine=${line} to continue.]` : "";
    return { ok: true, text: `${header}\n${range}\n\n${out.join("\n")}${more}` };
  } catch {
    return { ok: false, text: `${header}\n\n${JSON.stringify({ error: "unavailable" })}` };
  }
}
