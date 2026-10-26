import { BUILD_PLAN_LIMITS, BUILD_UPLOAD_LIMITS, type BuildPlan, type BuildUpload } from "@shared/build-routine";
import { PROJECT_DOCS } from "../tools/project-docs";

const PROTECTED_PATH_SEGMENTS = new Set([
  ".git", ".github", ".claude", "agents.md", "agents.override.md", "claude.md", "claude.local.md", "gemini.md",
  ".cursor", ".cursorrules", ".codex", ".agents", ".gemini", ".vscode", ".devcontainer", ".husky", ".idea",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", "scripts", ".gitmodules",
  "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "bun.lock", "bun.lockb",
]);

// 规则文档与 PROJECT_DOCS 都从 main 读，合并前不生效，所以放行，只在 PR 的重点审查里标出；
// 拒绝名单只留分支上会被执行或被 agent 当指令加载的东西（PR 工作流、Workers Builds 预览、检出分支的 Claude 会话）。
const RULE_DOC_NAMES = new Set(["human.md", "review.md", "design.md", "glossary.md"]);
const RULE_DOC_PATHS = new Set([
  "docs/ops-facts.md",
  "docs/api-contracts.md",
  ...Object.values(PROJECT_DOCS).flatMap((doc) => "repo" in doc ? [] : [doc.path.toLowerCase()]),
]);

const SCRIPT_SUFFIX = /\.(?:[cm]?[jt]sx?|py|sh)$/i;
const PUBLIC_EXECUTABLE = /\.(?:[cm]?js|html?|xht(?:ml)?|svg|xml)$/i;
const PUBLIC_HEADER_FILES = new Set(["_headers", "_redirects"]);

function protectedPathSegment(segment: string): boolean {
  const lower = segment.toLowerCase();
  return PROTECTED_PATH_SEGMENTS.has(lower) || lower.startsWith(".windsurf") || /^wrangler.*\.(?:toml|jsonc?)$/.test(lower) || /^(?:next|vite|react-router)\.config\./.test(lower);
}

function protectedBuildPath(path: string): boolean {
  return path.split("/").some(protectedPathSegment);
}

export function ruleDoc(path: string): boolean {
  return RULE_DOC_PATHS.has(path.toLowerCase()) || RULE_DOC_NAMES.has(path.slice(path.lastIndexOf("/") + 1).toLowerCase());
}

function wellFormedPath(path: string): boolean {
  if (!path || path.length > 240 || !/^[A-Za-z0-9_@().[\] /-]+$/.test(path) || path.trim() !== path) return false;
  return !path.split("/").some((part) => !part || part === "." || part === "..");
}

export function allowedBuildPath(path: string): boolean {
  if (!wellFormedPath(path) || protectedBuildPath(path)) return false;
  const segments = path.split("/");
  if (path.startsWith("docs/") && SCRIPT_SUFFIX.test(path)) return false;
  const name = segments[segments.length - 1].toLowerCase();
  if (path.startsWith("public/") && (PUBLIC_EXECUTABLE.test(path) || PUBLIC_HEADER_FILES.has(name))) return false;
  return /^(?:src|public|docs|shared)\//.test(path) || /^workers\/[^/]+\/src\//.test(path) || markdownDoc(path);
}

// 文档改了只是文字，PR 里单列给人审；agent 指令文件由受保护名挡掉，上报器单独部署不放开。
export function markdownDoc(path: string): boolean {
  return /\.md$/i.test(path) && !protectedBuildPath(path) && !path.split("/").some((segment) => segment.toLowerCase() === "reporters");
}

// 拒绝原因原样回给规划者：笼统的「计划无效」会让它不知道改哪里，一条回复的工具轮数就这样耗完。
export function checkBuildPlan(value: unknown): { plan: BuildPlan } | { error: string } {
  const limits = BUILD_PLAN_LIMITS;
  if (!value || typeof value !== "object") return { error: "The plan must be an object with title, spec, acceptance and paths." };
  const { title, spec, acceptance, paths } = value as Record<string, unknown>;
  if (typeof title !== "string" || typeof spec !== "string" || !Array.isArray(acceptance) || !Array.isArray(paths)) return { error: "title and spec must be strings; acceptance and paths must be arrays." };
  const cleanTitle = title.replace(/\s+/g, " ").trim();
  if (!cleanTitle || cleanTitle.length > limits.titleChars) return { error: `title must be 1 to ${limits.titleChars} characters; it has ${cleanTitle.length}.` };
  if (!spec.trim() || spec.length > limits.specChars) return { error: `spec must be 1 to ${limits.specChars} characters; it has ${spec.length}. Shorten it.` };
  if (!acceptance.length || acceptance.length > limits.acceptanceItems) return { error: `Give 1 to ${limits.acceptanceItems} acceptance checks; there are ${acceptance.length}.` };
  const badCheck = acceptance.findIndex((item) => typeof item !== "string" || !item.trim() || item.length > limits.acceptanceChars);
  if (badCheck >= 0) return { error: `Acceptance check ${badCheck + 1} must be a non-empty string of at most ${limits.acceptanceChars} characters.` };
  if (!paths.length || paths.length > limits.paths) return { error: `List 1 to ${limits.paths} paths; there are ${paths.length}.` };
  const badPath = paths.find((path) => typeof path !== "string" || !allowedBuildPath(path.replace(/\/$/, "/_")));
  if (badPath !== undefined) return { error: `Path ${JSON.stringify(badPath)} is not allowed. Use repository paths under src/, public/, docs/, shared/ or workers/*/src/ that avoid protected names.` };
  return { plan: { title: cleanTitle, spec: spec.trim(), acceptance: acceptance.map((item) => (item as string).trim()), paths: [...new Set(paths as string[])] } };
}

export function parseBuildPlan(value: unknown): BuildPlan | null {
  const checked = checkBuildPlan(value);
  return "plan" in checked ? checked.plan : null;
}

function withinBuildPlan(path: string, planPaths: readonly string[]): boolean {
  const directory = path.slice(0, path.lastIndexOf("/"));
  const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path);
  return planPaths.some((planned) => {
    if (planned.endsWith("/")) return path.startsWith(planned);
    return path === planned || testFile && directory === planned.slice(0, planned.lastIndexOf("/"));
  });
}

export function outsidePlanPaths(upload: Pick<BuildUpload, "files" | "deletions">, planPaths: readonly string[]): string[] {
  return [...upload.files.map((file) => file.path), ...upload.deletions].filter((path) => !withinBuildPlan(path, planPaths));
}

export type ParsedBuildUpload = BuildUpload & { dropped: string[] };

// 越界路径只从这次提交里剔掉、写进 PR 正文，不整份拒收：合并前 lyjw 还会审查，一个越界文件不该让整个构建作废。
export function parseBuildUpload(value: unknown): ParsedBuildUpload {
  if (!value || typeof value !== "object") throw new Error("Invalid upload payload.");
  const { baseSha, message, files, deletions } = value as Record<string, unknown>;
  if (typeof baseSha !== "string" || !/^[a-f0-9]{40}$/.test(baseSha)) throw new Error("Invalid base commit.");
  if (typeof message !== "string" || !message.trim() || message.length > BUILD_UPLOAD_LIMITS.messageChars) throw new Error("Invalid commit message.");
  if (!Array.isArray(files) || !Array.isArray(deletions) || !files.length && !deletions.length || files.length + deletions.length > BUILD_UPLOAD_LIMITS.files) throw new Error("Invalid number of changed files.");
  const paths = new Set<string>();
  let total = 0;
  const checkPath = (path: unknown): string => {
    if (typeof path !== "string" || !wellFormedPath(path)) throw new Error("A changed path is malformed.");
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
  const cleanDeletions = deletions.map(checkPath);
  const dropped = [...paths].filter((path) => !allowedBuildPath(path));
  if (dropped.length === paths.size) throw new Error(`Every changed path is outside the allowed scope: ${dropped.join(", ")}`);
  return { baseSha, message: message.trim(), files: cleanFiles.filter((file) => allowedBuildPath(file.path)), deletions: cleanDeletions.filter(allowedBuildPath), dropped };
}
