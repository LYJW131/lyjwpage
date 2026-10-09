export const GITHUB_ISSUE_PATH = "/api/github/issue";
export const GITHUB_ISSUE_REPO = "LYJW131/lyjwpage";
// GitHub App LYJW131 的 Client ID（公开值），与 .github/workflows/avatar-sync.yml 用的是同一个 App。
export const GITHUB_APP_CLIENT_ID = "Iv23liSmKTDKh0bxIfzB";
// 授权回调页在站点上，与打开它的卡片同源，code 只经 postMessage 交回同源窗口；每个站点域名的这条路径都要登记在 App 的回调地址里。
export const GITHUB_CALLBACK_PATH = "/github-callback";
export const GITHUB_SIGN_IN_MESSAGE = "github-sign-in";

export const GITHUB_ISSUE_LIMITS = { titleChars: 256, bodyChars: 8000 } as const;

export type GithubIssueDraft = { title: string; body: string };
export type GithubIssueRequest = GithubIssueDraft & { code: string };
export type GithubIssueResult = { url: string; number: number };

export function parseIssueDraft(value: unknown): GithubIssueDraft | null {
  if (!value || typeof value !== "object") return null;
  const { title, body } = value as Record<string, unknown>;
  if (typeof title !== "string" || typeof body !== "string") return null;
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > GITHUB_ISSUE_LIMITS.titleChars || body.length > GITHUB_ISSUE_LIMITS.bodyChars) return null;
  return { title: trimmed, body: body.trim() };
}

export function parseGithubIssueRequest(value: unknown): GithubIssueRequest | null {
  const draft = parseIssueDraft(value);
  const code = (value as { code?: unknown } | null)?.code;
  if (!draft || typeof code !== "string" || !/^[\w-]{1,100}$/.test(code)) return null;
  return { ...draft, code };
}
