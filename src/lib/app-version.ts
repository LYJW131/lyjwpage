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

/** 最多记住几个目标版本的账；再多的说明版本在来回抖，冷却在兜底 */
export const AUTO_RELOAD_MEMORY = 8;

/**
 * 同一个目标版本一轮里最多自动刷几次。
 *
 * 刷回来还是旧页面，多半是 ESA 边缘上的 HTML 还没换：隔一个冷却再试一次就够了，
 * 试满还没换说明边缘缓存卡住了，再刷也没用。
 */
export const AUTO_RELOAD_MAX_TRIES = 2;

/**
 * 一轮多长：距某个目标上一次试起过了这么久，它试过的次数清零。
 * 目的是边缘缓存恢复之后还能刷到它，而不是试满就永远不再试。
 */
export const AUTO_RELOAD_RETRY_AFTER_MS = 30 * 60_000;

/** 一个目标版本这一轮试过几次；`at` 是最近一次的时刻，一轮从它起算 */
export type AutoReloadTry = { sha: string; count: number; at: number };

/**
 * 这个标签页自动刷新的账：各个目标 sha 试了几次，以及最近一次刷新是什么时候。
 * 存在 sessionStorage 里（跨刷新保留、跨标签页隔离），所以要能从任意字符串里安全地读回来。
 * `at` 单独存而不是从 `tries` 里取最大：目标试成功后它那一条会被划掉，冷却的起点还得留着。
 */
export type AutoReloadLedger = {
  tries: AutoReloadTry[];
  at: number | null;
};

export const EMPTY_AUTO_RELOAD_LEDGER: AutoReloadLedger = { tries: [], at: null };

export function parseAutoReloadLedger(raw: string | null): AutoReloadLedger {
  if (!raw) return EMPTY_AUTO_RELOAD_LEDGER;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return EMPTY_AUTO_RELOAD_LEDGER;
    const row = value as { tries?: unknown; at?: unknown };
    // 同一个 sha 重复出现时后面的当最新
    const bySha = new Map<string, AutoReloadTry>();
    for (const item of Array.isArray(row.tries) ? row.tries : []) {
      const entry = item as Partial<Record<keyof AutoReloadTry, unknown>> | null;
      if (
        typeof entry?.sha !== "string" ||
        entry.sha.length === 0 ||
        !Number.isSafeInteger(entry.count) ||
        (entry.count as number) < 1 ||
        typeof entry.at !== "number" ||
        !Number.isFinite(entry.at)
      ) {
        continue;
      }
      bySha.delete(entry.sha);
      bySha.set(entry.sha, { sha: entry.sha, count: entry.count as number, at: entry.at });
    }
    const at = typeof row.at === "number" && Number.isFinite(row.at) ? row.at : null;
    return { tries: [...bySha.values()].slice(-AUTO_RELOAD_MEMORY), at };
  } catch {
    return EMPTY_AUTO_RELOAD_LEDGER;
  }
}

/** 这个目标这一轮的账；上一次试距今已过一轮就当没有 */
function currentRound(ledger: AutoReloadLedger, sha: string, now: number): AutoReloadTry | null {
  const entry = ledger.tries.find((known) => known.sha === sha);
  return entry && now - entry.at < AUTO_RELOAD_RETRY_AFTER_MS ? entry : null;
}

/** 刷新前记一笔：这个目标又试了一次，时刻是现在。每个 sha 只留一条，最多记 AUTO_RELOAD_MEMORY 条 */
export function recordAutoReload(ledger: AutoReloadLedger, sha: string, now: number): AutoReloadLedger {
  const count = (currentRound(ledger, sha, now)?.count ?? 0) + 1;
  return { tries: [...ledger.tries.filter((known) => known.sha !== sha), { sha, count, at: now }].slice(-AUTO_RELOAD_MEMORY), at: now };
}

/**
 * 刷回来的页面已经就是那个版本：那次尝试成功了，从账里划掉。
 *
 * 账拦的是「试了、页面还是旧的」（ESA 边缘上的 HTML 还没换）。试成功的版本不该一直
 * 拦着，否则以后部署回滚到它（页面在别的版本上、`/api/version` 答回它）就再也刷不了。
 * 没有变化时原样返回同一个对象，调用方靠引用判要不要写回。
 */
export function settleAutoReloadLedger(ledger: AutoReloadLedger, pageCommit: string | null | undefined): AutoReloadLedger {
  if (!pageCommit || !ledger.tries.some((known) => known.sha === pageCommit)) return ledger;
  return { ...ledger, tries: ledger.tries.filter((known) => known.sha !== pageCommit) };
}

/**
 * 系统时钟被往回拨过：账里比现在还晚的时刻不可信，一律当成刚发生，冷却和「一轮」都从现在
 * 重新数，不会照着一个未来的时刻干等。没有变化时原样返回同一个对象，调用方靠引用判要不要写回。
 *
 * 改完必须由调用方写回存储：只在判定时临时拉回，下一次读出来的还是那个未来的时刻，
 * 每次都从「现在」重新数起，永远等不到。
 */
export function rebaseAutoReloadLedger(ledger: AutoReloadLedger, now: number): AutoReloadLedger {
  const future = (at: number | null): at is number => at !== null && at > now;
  if (!future(ledger.at) && !ledger.tries.some((known) => future(known.at))) return ledger;
  return {
    tries: ledger.tries.map((known) => (future(known.at) ? { ...known, at: now } : known)),
    at: future(ledger.at) ? now : ledger.at,
  };
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

/** `wait`：现在不行、过 `ms` 毫秒再判（冷却，或这个目标这一轮试满了）；`skip`：这次不刷，靠事件（可见性、版本变化）再触发 */
export type AutoReloadDecision = { action: "reload" } | { action: "wait"; ms: number } | { action: "skip" };

/**
 * 只在确知旧页面（`stale`，不是 `unknown`）时才动手，并且有这几道闸：
 *
 * 1. **每个目标 sha 一轮最多试 AUTO_RELOAD_MAX_TRIES 次，账按目标分别记，不是只记「最后一个」。**
 *    `lyjw131.com` 的首页 HTML 由 ESA 缓存，新部署后有一段「`/api/version` 已经是新的、
 *    边缘上的 HTML 还是旧的」的窗口，刷回来还是旧页面就再判旧、再刷。版本接口在两个 sha 间
 *    来回（部署回滚往返）时，只记最后一个的话标记会被交替覆盖、每次都放行。试满的目标要等
 *    AUTO_RELOAD_RETRY_AFTER_MS（从它最近一次试起算）才清零重来，边缘缓存恢复后还刷得到它；
 *    页面刷回来已经是那个版本时直接划掉（`settleAutoReloadLedger`）。
 * 2. **冷却**：距上一次自动刷新不到 AUTO_RELOAD_COOLDOWN_MS 就不刷，返回还要等多久。
 *    第一道拦的是「同一个版本」，冷却拦的是「版本一直在变」，给重复刷新和重复上报 Sentry 封顶。
 *    账里的时刻晚于现在（系统时钟被拨回过）按刚发生算，见 `rebaseAutoReloadLedger`。
 * 3. **播放器在放就不刷。** 刷新的代价是一段音乐，比一张卡暂时旧着贵得多。
 * 4. **存储不可用就不刷。** 记不住账就没法保证不循环。
 */
export function autoReloadDecision(input: AutoReloadInput): AutoReloadDecision {
  const { latestCommit, now } = input;
  if (input.status !== "stale" || !latestCommit) return { action: "skip" };
  if (!input.ledger) return { action: "skip" };
  if (input.playerBusy) return { action: "skip" };
  if (input.trigger === "background" && !input.hidden) return { action: "skip" };
  const ledger = rebaseAutoReloadLedger(input.ledger, now);
  const round = currentRound(ledger, latestCommit, now);
  const untilRetry = round && round.count >= AUTO_RELOAD_MAX_TRIES ? round.at + AUTO_RELOAD_RETRY_AFTER_MS - now : 0;
  const untilCooldown = ledger.at === null ? 0 : ledger.at + AUTO_RELOAD_COOLDOWN_MS - now;
  const ms = Math.max(untilRetry, untilCooldown);
  return ms > 0 ? { action: "wait", ms } : { action: "reload" };
}
