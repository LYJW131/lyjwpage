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
 *   才发现整页在拿新形状的数据崩，就晚了：标签页放了很久，收到推送刷新的端点可能已经
 *   换了形状。**前台不自动刷**：那时只提示（版本提示卡，以及兜底卡片上的说明），刷不刷
 *   交给人 —— 一张卡出错就把整页刷掉，会打断他在别的卡片上的操作。
 * - `page-crash`：整页已经被错误页顶替（app/error.tsx），没有什么交互可打断，所以不看
 *   可见性。卡片级的错误不用这个，卡片有自己的错误边界，见 components/card-boundary。
 */
export type AutoReloadTrigger = "background" | "page-crash";

/**
 * 同一个标签页两次自动刷新之间至少隔这么久。
 *
 * 部署接连来的时候（开发时几分钟里推好几次很常见）刷一次就够了，别每来一个新版本就刷一次；
 * 冷却期里若仍是旧的，到点再判，见 `autoReloadDecision` 的 `wait`。
 */
export const AUTO_RELOAD_COOLDOWN_MS = 5 * 60_000;

/** 记住最近试过几个目标版本；再多的说明版本在来回抖，冷却在兜底 */
export const AUTO_RELOAD_MEMORY = 8;

/**
 * 这个标签页自动刷新的账：试过哪些目标 sha、最近一次刷新是什么时候。
 * 存在 sessionStorage 里（跨刷新保留、跨标签页隔离），所以要能从任意字符串里安全地读回来。
 */
export type AutoReloadLedger = {
  shas: string[];
  at: number | null;
};

export const EMPTY_AUTO_RELOAD_LEDGER: AutoReloadLedger = { shas: [], at: null };

export function parseAutoReloadLedger(raw: string | null): AutoReloadLedger {
  if (!raw) return EMPTY_AUTO_RELOAD_LEDGER;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return EMPTY_AUTO_RELOAD_LEDGER;
    const row = value as { shas?: unknown; at?: unknown };
    const shas = Array.isArray(row.shas)
      ? row.shas.filter((sha): sha is string => typeof sha === "string" && sha.length > 0).slice(-AUTO_RELOAD_MEMORY)
      : [];
    const at = typeof row.at === "number" && Number.isFinite(row.at) ? row.at : null;
    return { shas, at };
  } catch {
    return EMPTY_AUTO_RELOAD_LEDGER;
  }
}

/** 刷新前记一笔：这个目标试过了，时刻是现在。同一个 sha 只留一份，最多记 AUTO_RELOAD_MEMORY 个 */
export function recordAutoReload(ledger: AutoReloadLedger, sha: string, now: number): AutoReloadLedger {
  return { shas: [...ledger.shas.filter((known) => known !== sha), sha].slice(-AUTO_RELOAD_MEMORY), at: now };
}

/**
 * 刷回来的页面已经就是那个版本：那次尝试成功了，从「试过」里划掉。
 *
 * 「试过」拦的是「试了、页面还是旧的」（ESA 边缘上的 HTML 还没换）。试成功的版本不该一直
 * 拦着，否则以后部署回滚到它（页面在别的版本上、`/api/version` 答回它）就再也刷不了。
 * 没有变化时原样返回同一个对象，调用方靠引用判要不要写回。
 */
export function settleAutoReloadLedger(ledger: AutoReloadLedger, pageCommit: string | null | undefined): AutoReloadLedger {
  if (!pageCommit || !ledger.shas.includes(pageCommit)) return ledger;
  return { ...ledger, shas: ledger.shas.filter((sha) => sha !== pageCommit) };
}

/**
 * 系统时钟被往回拨过：冷却的起点比现在还晚就不可信，当成刚发生，从现在重新数一个冷却期，
 * 不会照着一个未来的时刻干等。没有变化时原样返回同一个对象，调用方靠引用判要不要写回。
 *
 * 改完必须由调用方写回存储：只在判定时临时拉回，下一次读出来的还是那个未来的时刻，
 * 每次都从「现在」重新数起，永远等不到。
 */
export function rebaseAutoReloadLedger(ledger: AutoReloadLedger, now: number): AutoReloadLedger {
  if (ledger.at === null || ledger.at <= now) return ledger;
  return { ...ledger, at: now };
}

export type AutoReloadInput = {
  status: AppVersionStatus;
  latestCommit: string | null;
  trigger: AutoReloadTrigger;
  /** `document.visibilityState === "hidden"` */
  hidden: boolean;
  /** 网页播放器有东西在放或在同步：整页重载会把音乐掐断 */
  playerBusy: boolean;
  /** 这个标签页自动刷新的账；null 是 sessionStorage 读写不了 */
  ledger: AutoReloadLedger | null;
  now: number;
};

/** `wait`：现在不行、过 `ms` 毫秒再判（冷却）；`skip`：这次不刷，靠事件（可见性、版本变化）再触发 */
export type AutoReloadDecision = { action: "reload" } | { action: "wait"; ms: number } | { action: "skip" };

/**
 * 只在确知旧页面（`stale`，不是 `unknown`）时才动手，并且有这几道闸：
 *
 * 1. **每个目标 sha 最多试一次，而且是一个集合，不是「最后一个」。** `lyjw131.com` 的首页
 *    HTML 由 ESA 缓存，新部署后有一段「`/api/version` 已经是新的、边缘上的 HTML 还是旧的」
 *    的窗口，刷回来还是旧页面就再判旧、再刷。版本接口在两个 sha 间来回（部署回滚往返）时，
 *    只记最后一个的话标记会被交替覆盖、每次都放行，所以记试过的全部（有上限），
 *    页面刷回来已经是那个版本时才划掉（`settleAutoReloadLedger`）。
 * 2. **冷却**：距上一次自动刷新不到 AUTO_RELOAD_COOLDOWN_MS 就不刷，返回还要等多久。
 *    集合拦的是「同一个版本」，冷却拦的是「版本一直在变」，给重复刷新和重复上报 Sentry 封顶。
 *    冷却的起点晚于现在（系统时钟被拨回过）按刚发生算，见 `rebaseAutoReloadLedger`。
 * 3. **播放器在放就不刷。** 刷新的代价是一段音乐，比一张卡暂时旧着贵得多。
 * 4. **存储不可用就不刷。** 记不住账就没法保证不循环。
 */
export function autoReloadDecision(input: AutoReloadInput): AutoReloadDecision {
  const { latestCommit } = input;
  if (input.status !== "stale" || !latestCommit) return { action: "skip" };
  if (!input.ledger) return { action: "skip" };
  const ledger = rebaseAutoReloadLedger(input.ledger, input.now);
  if (ledger.shas.includes(latestCommit)) return { action: "skip" };
  if (input.playerBusy) return { action: "skip" };
  if (input.trigger === "background" && !input.hidden) return { action: "skip" };
  if (ledger.at !== null) {
    const elapsed = input.now - ledger.at;
    if (elapsed < AUTO_RELOAD_COOLDOWN_MS) return { action: "wait", ms: AUTO_RELOAD_COOLDOWN_MS - elapsed };
  }
  return { action: "reload" };
}
