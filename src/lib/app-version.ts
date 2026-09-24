/**
 *「手上这份页面是不是最新」的判定。
 *
 * 两边都是构建期焊死的 `COMMIT_SHA`：这边是 HTML 里内联的那份（lib/build-info），
 * 那边是 `/api/version` 由此刻接管生产域名的那次部署报出的自己。纯函数，好测；
 * 取数和状态比对在 hooks/use-app-version。
 */

export type AppVersionStatus = "current" | "stale" | "unknown";

/** 站点自己的路由（不是 API Worker 的），同源请求；实现在 app/api/version */
export const APP_VERSION_PATH = "/api/version";

/** `/api/version` 的响应：接管生产域名的那次部署报出的自己 */
export type AppVersionPayload = {
  /** 完整 sha；构建时拿不到是 null */
  commit: string | null;
  /** 提交说明（Vercel 构建时注入）；本地构建是 null */
  message: string | null;
  /** 构建时刻，ISO 字符串 */
  builtAt: string | null;
};

/** 同一份构建重复部署时 sha 相同但构建时刻不同 —— 内容一样，不算旧，只比 sha */
export function resolveVersionStatus(
  pageCommit: string | null | undefined,
  latestCommit: string | null | undefined,
): AppVersionStatus {
  if (!pageCommit || !latestCommit) return "unknown";
  return pageCommit === latestCommit ? "current" : "stale";
}
