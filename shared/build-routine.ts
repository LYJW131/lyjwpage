export { BUILD_PATH, BUILD_SESSION_PATH, BUILD_STATUS_PATH, BUILD_UPLOAD_PATH, BUILD_PROGRESS_PATH, BUILD_WEBHOOK_PATH } from "./ai-paths";

export const BUILD_REPO = "LYJW131/lyjwpage";

// A short, bounded planning session limits paid Opus work independently of ordinary chat quotas.
export const BUILD_DESIGN_LIMITS = { ttlMs: 30 * 60_000, maxTurns: 12, windowMs: 60 * 60_000, everyone: 20 } as const;
export const BUILD_TOKEN_MAX_CHARS = 64_000;
export const BUILD_PLAN_TTL_MS = 60 * 60_000;
export const BUILD_SESSION_TTL_MS = 24 * 60 * 60_000;
export const BUILD_TIMEOUT_MS = 45 * 60_000;
export const BUILD_STATUS_TTL_MS = 30 * 24 * 60 * 60_000;
export const BUILD_RECONCILE_MS = 60_000;
export const BUILD_PLAN_LIMITS = { titleChars: 100, specChars: 6000, acceptanceItems: 8, acceptanceChars: 300, paths: 30 } as const;
export const BUILD_QUOTA = { windowMs: 60 * 60_000, fire: { account: 3, everyone: 10 } } as const;
export const BUILD_UPLOAD_LIMITS = { files: 80, fileBytes: 512 * 1024, totalBytes: 2 * 1024 * 1024, requestBytes: 3 * 1024 * 1024, messageChars: 2000 } as const;

export type BuildPlan = { title: string; spec: string; acceptance: string[]; paths: string[] };
export type BuildProposal = { plan: BuildPlan; token: string; expiresAt: number };
export type BuildSession = { session: string; login: string; name: string | null; expiresAt: number };
export type BuildFireResult = { runId: string; branch: string; statusToken: string };
export type BuildPhase = "triggered" | "running" | "uploaded" | "validated" | "blocked" | "pr_open" | "merged" | "closed" | "timeout" | "failed";
export type BuildSignal = { state: string; url?: string; updatedAt: number };
export type BuildRun = {
  runId: string;
  branch: string;
  phase: BuildPhase;
  createdAt: number;
  updatedAt: number;
  reason?: string;
  progress?: string;
  pr?: { number: number; url: string; headSha: string };
  ci?: BuildSignal;
  preview?: BuildSignal;
  review?: BuildSignal;
  reconciledAt?: number;
  githubUpdatedAt?: number;
};
export type BuildUpload = { baseSha: string; message: string; files: { path: string; content: string; mode: "100644" | "100755" }[]; deletions: string[] };

export function newRunId(): string { return crypto.randomUUID().replaceAll("-", ""); }
export function branchForRun(runId: string): string { return `claude/build-${runId}`; }
export function runIdFromBranch(ref: string): string | null {
  const match = /^(?:refs\/heads\/)?claude\/build-([a-f0-9]{32})$/.exec(ref);
  return match?.[1] ?? null;
}
export function buildIssueBody(plan: BuildPlan): string {
  return `${plan.spec}\n\n## Acceptance criteria\n${plan.acceptance.map((item) => `- [ ] ${item}`).join("\n")}\n\n## Planned paths\n${plan.paths.map((path) => `- \`${path}\``).join("\n")}`;
}
