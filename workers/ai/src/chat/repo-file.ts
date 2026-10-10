import type Anthropic from "@anthropic-ai/sdk";

import { site } from "@/lib/site";

import type { ReadDoc } from "../tools/project-docs";

// 只给设计会话：规划者要看到真实代码才能列准路径。仓库本来公开，读的是 main 上的原文件。
export const REPO_FILE_LIMITS = { chars: 12_000, readsPerReply: 8, pathChars: 240 } as const;

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

export async function readRepoFile(read: ReadDoc, request: RepoFileRequest): Promise<{ ok: boolean; text: string }> {
  const header = `Source: ${repoFileUrl(request.path, "blob")}`;
  try {
    const response = await read(repoFileUrl(request.path, "raw"));
    if (response.status === 404) return { ok: false, text: `${header}\n\nNo such file on main. Check the path; read_project_doc shows where things live.` };
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
