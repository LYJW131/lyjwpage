/**
 *「手上这份页面是不是最新」的判定。
 *
 * 两边都是构建期焊死的 `COMMIT_SHA`：这边是 HTML 里内联的那份（lib/build-info），
 * 那边是 Commit 栏同步的线上生产部署 sha。纯函数，好测；
 * 取数和状态比对在 hooks/use-app-version。
 */

export type AppVersionStatus = "current" | "stale" | "unknown";

/**
 * 此刻**真正在服务**的那一版生产部署。
 *
 * 不能直接拿 payload 里的 `production`：它取自 Vercel 项目的 `targets.production`，
 * 而那个字段在构建**一开始**就切到新部署上了，`state` 还是 `BUILDING`、`ready`
 * 也还没有。拿它判「有新版本」会在部署完成之前就弹提示，点「立即刷新」拿到的
 * 还是旧页面；构建时长那一段也会因为 `ready` 缺席而算不出来。
 *
 * 所以只认 `READY`。正在构建的那段时间退回最近一批里最新的那个 READY 生产部署，
 * 免得提示在整个构建窗口里先消失、构建完再冒出来。回滚仍然正确：回滚后
 * `targets.production` 指向的那个旧部署本身就是 READY，走第一条就返回它，
 * 不会被 `recent` 里更新的那些盖掉。
 */
export function servingDeployment<
  T extends { state: string; target: string; createdAt: number },
>(production: T | null | undefined, recent: readonly T[] | undefined): T | null {
  if (production?.state === "READY") return production;
  const ready = (recent ?? [])
    .filter((item) => item.target === "production" && item.state === "READY")
    .sort((a, b) => b.createdAt - a.createdAt);
  return ready[0] ?? null;
}

/** 同一份构建重复部署时 sha 相同但构建时刻不同 —— 内容一样，不算旧，只比 sha */
export function resolveVersionStatus(
  pageCommit: string | null | undefined,
  latestCommit: string | null | undefined,
): AppVersionStatus {
  if (!pageCommit || !latestCommit) return "unknown";
  return pageCommit === latestCommit ? "current" : "stale";
}
