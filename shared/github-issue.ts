import { BUILD_TOKEN_MAX_CHARS } from "./build-routine";

export { GITHUB_ISSUE_PATH } from "./ai-paths";
export const GITHUB_ISSUE_REPO = "LYJW131/lyjwpage";
// GitHub App LYJW131 的 Client ID（公开值），与 .github/workflows/avatar-sync.yml 用的是同一个 App。
export const GITHUB_APP_CLIENT_ID = "Iv23liSmKTDKh0bxIfzB";
// 授权回调页在站点上，与打开它的卡片同源，code 只经 postMessage 交回同源窗口；每个站点域名的这条路径都要登记在 App 的回调地址里。
export const GITHUB_CALLBACK_PATH = "/github-callback";
export const GITHUB_SIGN_IN_MESSAGE = "github-sign-in";

// codeVerifier 是 PKCE（RFC 7636，S256）的原文：浏览器每次提交现生成，授权 URL 只带它的 SHA-256，兑换 token 时 Worker 原样转给 GitHub。
export type GithubIssueRequest = { planToken: string; code: string; codeVerifier: string };
export type GithubIssueResult = { url: string; number: number };

export function parseGithubIssueRequest(value: unknown): GithubIssueRequest | null {
  const { planToken, code, codeVerifier } = (value ?? {}) as { planToken?: unknown; code?: unknown; codeVerifier?: unknown };
  if (typeof planToken !== "string" || !planToken || planToken.length > BUILD_TOKEN_MAX_CHARS) return null;
  if (typeof code !== "string" || !/^[\w-]{1,100}$/.test(code)) return null;
  if (typeof codeVerifier !== "string" || !/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return null;
  return { planToken, code, codeVerifier };
}
