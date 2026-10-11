import { BUILD_REPO } from "@shared/build-routine";

import { currentMain, GithubBuildApi, installationApi, validSha } from "../build/github";
import { readBoundedBytes } from "../build/http";
import type { Env } from "../runtime";

const MAX_TREE_ENTRIES = 20_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_GLOB_RESULTS = 200;
const MAX_GREP_FILES = 60;
const MAX_GREP_MATCHES = 100;
const MAX_GREP_CHARS = 16 * 1024;
const MAX_PATTERN_CHARS = 300;
const MAX_GLOB_WILDCARDS = 12;
const MAX_LINE_CHARS = 2000;
const FETCH_TIMEOUT_MS = 20_000;
const RAW_BASE = `https://raw.githubusercontent.com/${BUILD_REPO}`;
const REGULAR_MODES = new Set(["100644", "100755"]);

export type RepoStore = {
  get(key: string): string | undefined;
  put(key: string, value: string): void;
};

export type DesignerRepository = {
  readonly sha: string;
  list(pattern: string): { paths: string[]; truncated: boolean };
  read(path: string, offset?: number, limit?: number): Promise<{ text: string } | { error: string }>;
  grep(query: string, pattern: string, caseSensitive: boolean): Promise<{ text: string } | { error: string }>;
};

type RepoRecord = { sha: string; files: Record<string, string> };

// 仓库相对路径：拒绝绝对路径、点段、空段、反斜杠、控制字符和 URL 编码痕迹，之后还必须出现在清单里。
export function cleanPath(path: unknown): string | null {
  if (typeof path !== "string" || !path || path.length > 1024 || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (/[\x00-\x1f\x7f\\%#?]/.test(path)) return null;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return segments.join("/");
}

// 只实现 glob 的 *, **, ?：不走正则——*a*a*…b 这类模式能让正则回溯爆炸。带备忘的递归匹配按 (pattern, path)
// 位置去重，加上通配符个数上限，最坏工作量有界；语义与原来的展开一致：`**/` 匹配零或多层目录，`**` 可跨 /，
// `*` 与 `?` 不跨 /。
export function globMatcher(pattern: unknown): ((path: string) => boolean) | null {
  if (typeof pattern !== "string" || !pattern || pattern.length > MAX_PATTERN_CHARS || /[\x00-\x1f\x7f]/.test(pattern)) return null;
  let wildcards = 0;
  for (const char of pattern) if (char === "*" || char === "?") wildcards++;
  if (wildcards > MAX_GLOB_WILDCARDS) return null;
  return (path: string) => {
    const memo = new Map<number, boolean>();
    const go = (pi: number, si: number): boolean => {
      const key = pi * (path.length + 1) + si;
      const saved = memo.get(key);
      if (saved !== undefined) return saved;
      let out = false;
      if (pi === pattern.length) {
        out = si === path.length;
      } else if (pattern[pi] === "*") {
        if (pattern[pi + 1] === "*") {
          if (pattern[pi + 2] === "/") {
            // `**/` 匹配零段，或任意字符后以一个 `/` 收尾：只有落在 / 后的位置才继续。
            out = go(pi + 3, si);
            for (let j = si; !out && j < path.length; j++) {
              if (path[j] === "/" && go(pi + 3, j + 1)) out = true;
            }
          } else {
            out = go(pi + 2, si) || (si < path.length && go(pi, si + 1));
          }
        } else {
          out = go(pi + 1, si) || (si < path.length && path[si] !== "/" && go(pi, si + 1));
        }
      } else if (pattern[pi] === "?") {
        out = si < path.length && path[si] !== "/" && go(pi + 1, si + 1);
      } else {
        out = si < path.length && path[si] === pattern[pi] && go(pi + 1, si + 1);
      }
      memo.set(key, out);
      return out;
    };
    return go(0, 0);
  };
}

type TreeEntry = { path?: unknown; type?: unknown; mode?: unknown; sha?: unknown };
type TreeResponse = { tree?: unknown; truncated?: unknown };

export async function openRepository({ env, fetcher = fetch, store }: { env: Env; fetcher?: typeof fetch; store: RepoStore }): Promise<DesignerRepository> {
  const saved = store.get("repo");
  if (saved) {
    const record = JSON.parse(saved) as RepoRecord;
    if (validSha(record.sha) && record.files && typeof record.files === "object") return makeRepository(record, fetcher, store);
  }
  const api = env.GITHUB_APP_PRIVATE_KEY ? await installationApi(env, fetcher, true) : new GithubBuildApi(undefined, fetcher);
  const sha = await currentMain(api);
  const data = await api.repo<TreeResponse>(`/git/trees/${sha}?recursive=1`);
  if (!Array.isArray(data.tree) || data.truncated === true || data.tree.length > MAX_TREE_ENTRIES) {
    throw new Error("The repository snapshot is unavailable.");
  }
  const files: Record<string, string> = {};
  for (const entry of data.tree as TreeEntry[]) {
    if (entry.type === "blob" && REGULAR_MODES.has(String(entry.mode)) && validSha(entry.sha) && cleanPath(entry.path)) {
      files[entry.path as string] = entry.sha as string;
    }
  }
  const record: RepoRecord = { sha, files };
  store.put("repo", JSON.stringify(record));
  return makeRepository(record, fetcher, store);
}

function makeRepository(record: RepoRecord, fetcher: typeof fetch, store: RepoStore): DesignerRepository {
  const matchPaths = (matcher: ((path: string) => boolean) | null) => (matcher ? Object.keys(record.files).filter(matcher) : []);

  const blob = async (path: string): Promise<string | null> => {
    const sha = record.files[path];
    if (!sha) return null;
    const cached = store.get(`blob:${sha}`);
    if (cached !== undefined) return cached;
    const response = await fetcher(`${RAW_BASE}/${record.sha}/${path.split("/").map(encodeURIComponent).join("/")}`, {
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const bytes = await readBoundedBytes(response.body, MAX_FILE_BYTES);
    if (!bytes) return null;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      return null;
    }
    if (text.includes("\0")) return null;
    const cachedBytes = Number(store.get("cache_bytes") ?? 0);
    if (Number.isSafeInteger(cachedBytes) && cachedBytes + bytes.byteLength <= MAX_CACHE_BYTES) {
      store.put(`blob:${sha}`, text);
      store.put("cache_bytes", String(cachedBytes + bytes.byteLength));
    }
    return text;
  };

  return {
    sha: record.sha,
    list(pattern) {
      const matcher = globMatcher(pattern);
      if (!matcher) return { paths: [], truncated: false };
      const matches = matchPaths(matcher);
      return { paths: matches.slice(0, MAX_GLOB_RESULTS), truncated: matches.length > MAX_GLOB_RESULTS };
    },
    async read(path, offset = 1, limit = 300) {
      const clean = cleanPath(path);
      if (!clean || !record.files[clean]) return { error: `No such file in the repository snapshot: ${String(path)}` };
      const text = await blob(clean);
      if (text === null) return { error: `The file could not be read: ${clean}` };
      const lines = text.split("\n");
      const start = Math.max(0, Math.min(offset - 1, lines.length));
      // 逐行累到有界输出为止，继续点落在最后一条完整行之后：截断不再跳行。
      const shown: string[] = [];
      let chars = 0;
      for (let index = start; index < lines.length && shown.length < limit; index++) {
        const line = lines[index];
        const clipped = line.length > MAX_LINE_CHARS;
        const row = `${index + 1}\t${clipped ? `${line.slice(0, MAX_LINE_CHARS)}… [line clipped]` : line}`;
        if (shown.length > 0 && chars + row.length > MAX_GREP_CHARS) break;
        shown.push(row);
        chars += row.length;
      }
      const last = start + shown.length;
      const more = last < lines.length;
      const range = shown.length ? `, showing ${start + 1}-${last}${more ? `; continue with offset ${last + 1}` : ""}` : "";
      return { text: `${clean}: ${lines.length} lines${range}\n\n${shown.join("\n")}` };
    },
    async grep(query, pattern, caseSensitive) {
      if (typeof query !== "string" || !query || query.length > MAX_PATTERN_CHARS) return { error: "The query must be a non-empty string." };
      const matcher = globMatcher(pattern);
      if (!matcher) return { error: "The glob is invalid." };
      const files = matchPaths(matcher);
      if (files.length > MAX_GREP_FILES) return { error: `The glob matched ${files.length} files; narrow it to at most ${MAX_GREP_FILES}.` };
      const needle = caseSensitive ? query : query.toLowerCase();
      const matches: string[] = [];
      const skipped: string[] = [];
      let chars = 0;
      let truncated = false;
      let filesHit = 0;
      for (const path of files) {
        const text = await blob(path);
        if (text === null) { skipped.push(path); continue; }
        let hit = false;
        for (const [index, line] of text.split("\n").entries()) {
          const haystack = caseSensitive ? line : line.toLowerCase();
          if (!haystack.includes(needle)) continue;
          hit = true;
          const shown = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}… [line clipped]` : line;
          const row = `${path}:${index + 1}: ${shown}`;
          if (matches.length >= MAX_GREP_MATCHES || chars + row.length > MAX_GREP_CHARS) { truncated = true; break; }
          matches.push(row);
          chars += row.length;
        }
        filesHit += hit ? 1 : 0;
        if (truncated) break;
      }
      const head = `${matches.length} match${matches.length === 1 ? "" : "es"} in ${filesHit} file${filesHit === 1 ? "" : "s"}`
        + `${truncated ? " (truncated; narrow the glob or query)" : ""}`
        + `${skipped.length ? `; skipped ${skipped.length} unreadable file${skipped.length === 1 ? "" : "s"}: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ", …" : ""}` : ""}`;
      return { text: `${head}${matches.length ? `\n${matches.join("\n")}` : ""}` };
    },
  };
}
