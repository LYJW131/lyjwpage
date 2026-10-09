import { BUILD_PLAN_LIMITS, BUILD_UPLOAD_LIMITS, type BuildPlan, type BuildUpload } from "@shared/build-routine";

export function allowedBuildPath(path: string): boolean {
  if (!path || path.length > 240 || !/^[A-Za-z0-9_@().\[\] /-]+$/.test(path) || path.trim() !== path) return false;
  const segments = path.split("/");
  if (segments.some((part) => !part || part === "." || part === "..")) return false;
  if (segments.some((part) => [".git", ".github", ".claude", "AGENTS.md", "CLAUDE.md", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", "scripts", ".gitmodules", "vercel.json"].includes(part))) return false;
  if (segments.some((part) => /^wrangler.*\.toml$/i.test(part) || /^next\.config\./i.test(part))) return false;
  if (path.startsWith("reporters/")) return false;
  return /^(?:src|public|docs|shared)\//.test(path) || /^workers\/[^/]+\/src\//.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

export function parseBuildPlan(value: unknown): BuildPlan | null {
  if (!value || typeof value !== "object") return null;
  const { title, spec, acceptance, paths } = value as Record<string, unknown>;
  if (typeof title !== "string" || typeof spec !== "string" || !Array.isArray(acceptance) || !Array.isArray(paths)) return null;
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  if (!cleanTitle || cleanTitle.length > BUILD_PLAN_LIMITS.titleChars || !spec.trim() || spec.length > BUILD_PLAN_LIMITS.specChars) return null;
  if (!acceptance.length || acceptance.length > BUILD_PLAN_LIMITS.acceptanceItems || acceptance.some((item) => typeof item !== "string" || !item.trim() || item.length > BUILD_PLAN_LIMITS.acceptanceChars)) return null;
  if (!paths.length || paths.length > BUILD_PLAN_LIMITS.paths || paths.some((path) => typeof path !== "string" || !allowedBuildPath(path.replace(/\/$/, "/_")))) return null;
  const text = `${cleanTitle}\n${spec}\n${acceptance.join("\n")}`;
  const mentionedPaths = text.match(/(?:\.[\w-]+|[\w-]+)(?:\/[\w.@()[\]-]+)+|(?:AGENTS|CLAUDE)\.md|package\.json|pnpm-(?:lock\.yaml|workspace\.yaml)|\.npmrc|wrangler[^\s`]*\.toml|next\.config\.[\w]+|vercel\.json|\.gitmodules/g) ?? [];
  if (mentionedPaths.some((path) => /(?:^|\/)(?:\.github|\.claude|scripts|reporters)(?:\/|$)/.test(path) || /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|wrangler.*\.toml|next\.config\.[^/]+|vercel\.json|\.gitmodules)$/.test(path))) return null;
  return { title: cleanTitle, spec: spec.trim(), acceptance: acceptance.map((item) => (item as string).trim()), paths: [...new Set(paths as string[])] };
}

export function parseBuildUpload(value: unknown): BuildUpload {
  if (!value || typeof value !== "object") throw new Error("Invalid upload payload.");
  const { baseSha, message, files, deletions } = value as Record<string, unknown>;
  if (typeof baseSha !== "string" || !/^[a-f0-9]{40}$/.test(baseSha)) throw new Error("Invalid base commit.");
  if (typeof message !== "string" || !message.trim() || message.length > BUILD_UPLOAD_LIMITS.messageChars) throw new Error("Invalid commit message.");
  if (!Array.isArray(files) || !Array.isArray(deletions) || !files.length && !deletions.length || files.length + deletions.length > BUILD_UPLOAD_LIMITS.files) throw new Error("Invalid number of changed files.");
  const paths = new Set<string>();
  let total = 0;
  const checkPath = (path: unknown): string => {
    if (typeof path !== "string" || !allowedBuildPath(path)) throw new Error("A changed path is outside the allowed scope.");
    if (paths.has(path)) throw new Error("Duplicate changed path.");
    paths.add(path);
    return path;
  };
  const cleanFiles: BuildUpload["files"] = files.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid file entry.");
    const { path, mode, content } = entry as Record<string, unknown>;
    const cleanPath = checkPath(path);
    if (mode !== "100644" && mode !== "100755") throw new Error("Only regular files are allowed; symlinks and submodules are blocked.");
    if (typeof content !== "string" || content.length > Math.ceil(BUILD_UPLOAD_LIMITS.fileBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new Error("Invalid or oversized file content.");
    const size = content.length / 4 * 3 - (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0);
    if (size > BUILD_UPLOAD_LIMITS.fileBytes) throw new Error("File exceeds the size limit.");
    total += size;
    return { path: cleanPath, mode, content };
  });
  if (total > BUILD_UPLOAD_LIMITS.totalBytes) throw new Error("Upload exceeds the total size limit.");
  return { baseSha, message: message.trim(), files: cleanFiles, deletions: deletions.map(checkPath) };
}
