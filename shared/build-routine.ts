export const BUILD_PATH = "/api/build";
export const BUILD_REPO = "LYJW131/lyjwpage";
export const BUILD_REQUEST_MAX_CHARS = 8000;

// 须与 docs/build-routine.md 里 routine 提示词的分支名同步：/build 靠它把 PR 认回对应的那次提交。
const BRANCH_PREFIX = "claude/build-";
const RUN_ID = /^[a-z0-9]{8}$/;

export type BuildFireResult = { runId: string; branch: string; sessionUrl: string };

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

// 契约：routine 收到的 fire text 就是这个 JSON 字符串，提示词按 runId / request 两个字段取值。
export function fireText(runId: string, request: string): string {
  return JSON.stringify({ runId, request });
}
