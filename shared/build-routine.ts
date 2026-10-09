export const BUILD_PATH = "/api/build";
export const BUILD_SESSION_PATH = "/api/build/session";
export const BUILD_REPO = "LYJW131/lyjwpage";
export const BUILD_REQUEST_MAX_CHARS = 8000;

// 须与 docs/build-routine.md 里 routine 提示词的分支名、.github/workflows/build-pr.yml 的 runId 格式同步：/build 靠它把 PR 认回对应的那次提交。
const BRANCH_PREFIX = "claude/build-";
const RUN_ID = /^[a-z0-9]{8}$/;

export type BuildFireResult = { runId: string; branch: string; sessionUrl: string };

// session 是 Worker 签发的不透明串，浏览器原样存、原样回传；login / name 只给页面显示。
export type BuildSession = { session: string; login: string; name: string | null; expiresAt: number };

export function newRunId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

export function branchForRun(runId: string): string {
  return `${BRANCH_PREFIX}${runId}`;
}

export function runIdFromBranch(ref: string): string | null {
  if (!ref.startsWith(BRANCH_PREFIX)) return null;
  const runId = ref.slice(BRANCH_PREFIX.length);
  return RUN_ID.test(runId) ? runId : null;
}

// 契约：routine 收到的 fire text 就是这个 JSON 字符串。提示词按字段取值；coauthor 是一行 `Name <email>`，由 Worker 按验证过的 GitHub 身份拼好，routine 原样写进提交的 Co-authored-by。
export function fireText(runId: string, request: string, coauthor: string): string {
  return JSON.stringify({ runId, request, coauthor });
}
