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

/**
 * 什么场合下可以不等人点、替他把旧页面刷掉。
 *
 * - `background`：知道自己旧了，而且页面此刻在后台。没人在看，刷掉最安静；等他切回来
 *   才发现整页在拿新形状的数据崩，就晚了（LYJWPAGE-5：标签页放了一整天，收到推送
 *   刷新的限额端点已经换了形状）。
 * - `crash`：某张卡（或整页）已经因为渲染抛错退成兜底了，又确知页面是旧的 —— 这时
 *   刷新就是修复，可见也刷（LYJWPAGE-6：切回标签页那一下全量回源，新形状的 Pulse
 *   在版本回答之后 170 毫秒就把旧卡片打崩了）。
 */
export type AutoReloadTrigger = "background" | "crash";

export type AutoReloadInput = {
  status: AppVersionStatus;
  latestCommit: string | null;
  trigger: AutoReloadTrigger;
  /** `document.visibilityState === "hidden"` */
  hidden: boolean;
  /** 网页播放器有东西在放或在同步：整页重载会把音乐掐断 */
  playerBusy: boolean;
  /** 这个标签页已经为哪个 sha 自动刷过（sessionStorage 里记的）；null 是没刷过 */
  reloadedFor: string | null;
  /** sessionStorage 读写不了：记不住「刷过了」就没法防循环，宁可不刷 */
  storageUsable: boolean;
};

/**
 * 只在确知旧页面（`stale`，不是 `unknown`）时才动手，并且有三道闸：
 *
 * 1. **同一个目标 sha 只自动刷一次。** `lyjw131.com` 的首页 HTML 由 ESA 缓存，新部署后
 *    有一段「`/api/version` 已经是新的、边缘上的 HTML 还是旧的」的窗口；刷回来
 *    还是旧页面，再判旧、再刷，就成了循环。记下「已经为它刷过」，之后退回提示卡，
 *    交给人点。
 * 2. **播放器在放就不刷。** 刷新的代价是一段音乐，比一张卡暂时旧着贵得多。
 * 3. **存储不可用就不刷。** 没法落第 1 条那个标记，就没法保证不循环。
 */
export function shouldAutoReload(input: AutoReloadInput): boolean {
  if (input.status !== "stale" || !input.latestCommit) return false;
  if (!input.storageUsable) return false;
  if (input.reloadedFor === input.latestCommit) return false;
  if (input.playerBusy) return false;
  return input.trigger === "crash" || input.hidden;
}
