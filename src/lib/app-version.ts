/**
 *「手上这份页面是不是最新」的判定。
 *
 * 两边都是构建期焊死的 `COMMIT_SHA`：这边是 HTML 里内联的那份（lib/build-info），
 * 那边是 Commit 栏同步的线上生产部署 sha。纯函数，好测；
 * 取数和状态比对在 hooks/use-app-version。
 */

export type AppVersionStatus = "current" | "stale" | "unknown";

/** 同一份构建重复部署时 sha 相同但构建时刻不同 —— 内容一样，不算旧，只比 sha */
export function resolveVersionStatus(
  pageCommit: string | null | undefined,
  latestCommit: string | null | undefined,
): AppVersionStatus {
  if (!pageCommit || !latestCommit) return "unknown";
  return pageCommit === latestCommit ? "current" : "stale";
}
