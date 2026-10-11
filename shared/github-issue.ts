// GitHub App LYJW131 的 Client ID（公开值），与 .github/workflows/avatar-sync.yml 用的是同一个 App。
export const GITHUB_APP_CLIENT_ID = "Iv23liSmKTDKh0bxIfzB";
// 授权回调页在站点上，与打开它的卡片同源，code 只经 postMessage 交回同源窗口；每个站点域名的这条路径都要登记在 App 的回调地址里。
export const GITHUB_CALLBACK_PATH = "/github-callback";
export const GITHUB_SIGN_IN_MESSAGE = "github-sign-in";

export type GithubIssueResult = { url: string; number: number };
