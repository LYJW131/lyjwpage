import { archiveTrophies } from "../history";
import { ok, skipMissing, type Job, type JobResult } from "../job";
import { AuthSession } from "./auth";
import {
  hiddenTitleIds,
  isDryRun,
  playedGamesLimit,
  titleIdsHidden,
  withoutHiddenTitleIds,
  type Env,
} from "./env";
import {
  fetchPlayedGames,
  fetchPresence,
  fetchPurchasedLibrary,
  mergePlayedGames,
  overlayLibrary,
  withUnplayedPreorders,
  type LibraryTitle,
  type PlayedGamesReport,
  type PresenceReport,
} from "./psn";
import { deliver, readAudience, readPower } from "./site";
import {
  LIBRARY_CACHE_KEY,
  LIBRARY_TTL_MS,
  PLAYED_GAMES_CACHE_KEY,
  PLAYED_GAMES_FINGERPRINT_KEY,
  PLAYED_GAMES_IDLE_TTL_MS,
  PLAYED_GAMES_PLAYING_TTL_MS,
  TICK_META_KEY,
  TROPHIES_FINGERPRINT_KEY,
  TROPHY_CATALOG_KEY,
  asLibraryCache,
  asPlayedGamesCache,
  asTrophyCatalog,
  backoffMs,
  profileIdentityFresh,
  readAuth,
  readBackoffUntil,
  readFailureStreak,
  readFullTickStartedAt,
  writeBackoffUntil,
  writeFailureStreak,
  writeFullTickStartedAt,
  writeLibraryCache,
  writePlayedGamesCache,
  writeTrophyCatalog,
  type FailureStreak,
  type TickMeta,
  type TrophyCatalog,
} from "./state";
import {
  buildTrophiesReport,
  dirtyIndexRows,
  fetchProfileIdentity,
  fetchTrophySummary,
  fetchTrophyTitleSlice,
  fetchTrophyTitles,
  indexFingerprint,
  mapPlayByTrophy,
  mergePlayByTrophy,
  mergeTrophyTitles,
  playByTrophyFromTitles,
  playLinkGames,
  profileFromSummary,
  snapshotIndex,
  trophySummarySignature,
  type TrophiesReport,
  type TrophySummary,
} from "./trophies";
import { PsnUpstreamUnavailable, isUpstreamUnavailable, upstream } from "./util";

function playedGamesFingerprint(report: PlayedGamesReport): string {
  return JSON.stringify(report.items);
}

function recentPlayed(report: PlayedGamesReport, env: Env): PlayedGamesReport {
  const limit = playedGamesLimit(env);
  if (report.items.length <= limit) return report;
  return { ...report, items: report.items.slice(0, limit) };
}

function explain(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function trophiesFingerprintOf(hidden: Set<string>, body: string): string {
  return JSON.stringify({
    hidden: [...hidden].sort(),
    drop: "after-link",
    body,
  });
}

function filterHidden(report: TrophiesReport, hidden: Set<string>): TrophiesReport {
  if (!hidden.size) return report;
  return {
    ...report,
    titles: report.titles.filter((title) => !titleIdsHidden(title.titleIds, hidden)),
  };
}

function catalogProfile(
  profile: TrophiesReport["profile"],
  fetchedAt: number,
): TrophyCatalog["profile"] {
  return { ...profile, fetchedAt };
}

/**
 * 奖杯目录没变，但资料 TTL 过了：不翻目录、不爬明细，只重拉
 * onlineId / 头像 / Plus，整份交上去，好让站点上的头像真的会每天刷新。
 */
async function refreshStoredProfile(
  env: Env,
  auth: AuthSession,
  hidden: Set<string>,
  last: TrophyCatalog,
  summary: TrophySummary,
  nextFingerprint: string,
  summarySignature: string,
): Promise<{
  trophies: TrophiesReport;
  trophiesChanged: boolean;
  nextFingerprint: string;
  catalog: TrophyCatalog;
}> {
  const now = Date.now();
  const fetched: TrophiesReport = {
    observedAt: now,
    profile: profileFromSummary(await fetchProfileIdentity(env, auth, summary), summary),
    titles: last.titles,
  };
  console.log(JSON.stringify({ event: "playstation-trophy-sync", action: "profile" }));
  return {
    trophies: filterHidden(fetched, hidden),
    trophiesChanged: true,
    nextFingerprint,
    catalog: {
      ...last,
      fingerprint: nextFingerprint,
      summarySignature,
      profile: catalogProfile(fetched.profile, now),
    },
  };
}

/**
 * 奖杯只在整份齐了才交给 deliver。没变的标题从上次交付的目录合并，不重打 PSN。
 * 个人资料（onlineId / 头像 / Plus）按 PROFILE_TTL_MS 单独判断，不跟目录绑死。
 */
async function syncTrophies(
  env: Env,
  auth: AuthSession,
  hidden: Set<string>,
  overlaid: PlayedGamesReport,
  oldTrophiesFingerprint: string | null,
  last: TrophyCatalog | null,
  summary: TrophySummary,
): Promise<{
  trophies: TrophiesReport | null;
  trophiesChanged: boolean;
  nextFingerprint: string;
  catalog?: TrophyCatalog;
}> {
  const summarySignature = trophySummarySignature(hidden, summary);
  const profileFresh = profileIdentityFresh(last?.profile);

  if (last && last.summarySignature === summarySignature && last.fingerprint === oldTrophiesFingerprint) {
    if (profileFresh) {
      console.log(JSON.stringify({ event: "playstation-trophy-sync", action: "skip" }));
      return { trophies: null, trophiesChanged: false, nextFingerprint: last.fingerprint };
    }
    // quiet 也要过期重拉：头像 / Plus 不进奖杯指纹，不重拉就永远停在旧的。
    return refreshStoredProfile(env, auth, hidden, last, summary, last.fingerprint, summarySignature);
  }

  const titles = await fetchTrophyTitles(env, auth);
  const nextFingerprint = trophiesFingerprintOf(hidden, indexFingerprint(titles, summary));
  // 目录必须和指纹同一代：KV 先写 fp:trophies 再写 trophies:last，错代时
  // last.titles 是旧的，交上去会把站点刚收下的解锁整份盖掉。
  if (
    nextFingerprint === oldTrophiesFingerprint &&
    last &&
    last.fingerprint === oldTrophiesFingerprint
  ) {
    if (profileFresh) {
      return { trophies: null, trophiesChanged: false, nextFingerprint };
    }
    return refreshStoredProfile(env, auth, hidden, last, summary, nextFingerprint, summarySignature);
  }

  const titleIds = titles.map((title) => title.npCommunicationId);
  const dirty = last ? dirtyIndexRows(last.index, titles) : titles;
  console.log(
    JSON.stringify({
      event: "playstation-trophy-sync",
      action: "plan",
      dirty: dirty.length,
      total: titleIds.length,
      reused: titleIds.length - dirty.length,
    }),
  );

  const previousById = new Map((last?.titles ?? []).map((title) => [title.npCommunicationId, title]));
  const crawled = dirty.length ? await fetchTrophyTitleSlice(env, auth, dirty, previousById) : [];
  const merged = mergeTrophyTitles(last?.titles ?? [], crawled, titleIds);
  if (merged.length !== titleIds.length) {
    const missing = titleIds.filter((id) => !merged.some((title) => title.npCommunicationId === id));
    throw new Error(`奖杯目录缺 ${missing[0] ?? "未知标题"}`);
  }

  let byTrophy = playByTrophyFromTitles(merged, overlaid.items);
  if (merged.some((title) => title.titleIds.length === 0)) {
    const games = playLinkGames(overlaid);
    const mappedIds = new Set(merged.flatMap((title) => title.titleIds));
    const unmapped = games.filter((game) => !mappedIds.has(game.titleId));
    const toLink = unmapped.length ? unmapped : games;
    if (toLink.length) {
      byTrophy = mergePlayByTrophy(await mapPlayByTrophy(env, auth, toLink), byTrophy);
      console.log(
        JSON.stringify({
          event: "playstation-trophy-sync",
          action: "link",
          games: toLink.length,
          of: games.length,
        }),
      );
    }
  }

  // 资料还新鲜就别在 dirty 重爬时再打一遍；等级 / 总杯数走下面 summary 覆盖。
  const fetched = await buildTrophiesReport(
    env,
    auth,
    summary,
    merged,
    byTrophy,
    profileFresh ? last?.profile : null,
  );
  return {
    trophies: filterHidden(fetched, hidden),
    trophiesChanged: true,
    nextFingerprint,
    catalog: {
      fingerprint: nextFingerprint,
      summarySignature,
      index: snapshotIndex(titles),
      titles: fetched.titles,
      profile: catalogProfile(
        fetched.profile,
        profileFresh && last?.profile.fetchedAt != null ? last.profile.fetchedAt : Date.now(),
      ),
    },
  };
}

type TickResult = {
  meta: TickMeta;
  presence: PresenceReport;
  playedGames: PlayedGamesReport;
  trophies: TrophiesReport | null;
};

/**
 * 有人**正看着**站点时的完整 tick 间隔。cron 每分钟一响，卡 60 秒整的话早响半秒
 * 的那一轮会被门挡掉、实际退化成两分钟一轮，所以留 5 秒余量。
 */
const LIVE_TICK_INTERVAL_MS = 55_000;
/**
 * 页面**开着但都在后台**时的 tick 间隔（切走的标签页、锁了屏的手机）。同样留
 * 5 秒取整余量：2 分钟一轮。
 *
 * 这一档是为「切走了但还会切回来」留的 —— 那些页面在 `online` 那个数里算 0
 * （站点侧切到后台时向推送房间报 `hidden`），但连接不断，它们还在 `connections` 里。
 */
const OPEN_TICK_INTERVAL_MS = 115_000;
/**
 * 一个页面都没开时的完整 tick 间隔。同样留取整余量：每分钟的 cron 把它凑成整数分钟的一轮。
 *
 * 站点 `src/lib/freshness.ts` 的 `PLAYSTATION_STALE_MS`（三轮加余量）锚的就是这个数。
 * 要动它，先去改那边。
 */
const IDLE_TICK_INTERVAL_MS = 29.5 * 60_000;
/**
 * 上一轮完整 tick 的开始时刻，isolate 本地这一份。
 *
 * KV 的读有最长 60 秒的边缘缓存，而门的阈值正好在这个量级上：相邻两响里后一响
 * 可能还拿着写入之前的旧值，把同一轮放行两次。cron 每分钟一响，相邻两响多半落在
 * 同一个 isolate 上，所以和 KV 那份取较晚的一枚就能挡掉这种重复。两份记的都是
 * 真实发生过的开始时刻，取晚的不会误挡；isolate 冷起时它是 0，退回纯 KV 判断。
 */
let lastFullTickAt = 0;

type Gate = {
  run: boolean;
  sinceMs: number;
  /** 这一响真去问了的那些数；没问到那一步的留 null */
  online: number | null;
  open: number | null;
  /** 主机电源：true 开、false 关、null 没问到或问不出来 */
  power: boolean | null;
};

/**
 * cron 每分钟一响，这道门决定这一响要不要真跑一轮。
 *
 * 三档，由两个人头数分出来：有页面**可见**按 `LIVE_TICK_INTERVAL_MS`，只是**开着**（后台标签
 * 页、锁了屏的手机）按 `OPEN_TICK_INTERVAL_MS`，一个都没有按 `IDLE_TICK_INTERVAL_MS`。
 *
 * 门里只有两个读操作（KV 一枚时间戳 + 并行经 CORE 读人头数与电源），都排在任何贵操作之前：被挡
 * 下的那一轮完全不碰 PSN、不碰站点。而且是层层短路的 —— 攒够闲档就不问人数，
 * 没攒够快档阈值也不问。间隔算的是**上一轮开始**的时刻而不是成功的时刻 —— 否则
 * PSN 持续故障时，重试会从闲档一次恶化成每分钟一次。
 */
async function shouldTick(env: Env): Promise<Gate> {
  const lastAt = Math.max(await readFullTickStartedAt(env.COLLECTOR_KV), lastFullTickAt);
  const sinceMs = lastAt > 0 ? Date.now() - lastAt : Number.POSITIVE_INFINITY;
  // 攒够闲档就必跑，不必再问人数：闲时节奏不该依赖状态核心可不可达
  if (sinceMs >= IDLE_TICK_INTERVAL_MS) {
    return { run: true, sinceMs, online: null, open: null, power: null };
  }
  if (sinceMs < LIVE_TICK_INTERVAL_MS) {
    return { run: false, sinceMs, online: null, open: null, power: null };
  }

  const [{ online, open }, power] = await Promise.all([readAudience(env), readPower(env)]);
  const on = power?.on ?? null;

  /**
   * 开关在上一轮之后翻过面：立刻跑一轮，不问人数。开机要尽快把「正在游玩」
   * 接上，关机要尽快把它撤掉 —— 这两下 PSN 自己要分钟级才反应过来，而 HA
   * 在局域网里当场就知道。翻面时刻早于上一轮就说明那一轮已经带上了，不重跑。
   */
  if (power && power.observedAt > lastAt) {
    return { run: true, sinceMs, online, open, power: on };
  }
  /**
   * 主机关着：presence 不会再变，只留最慢那一档。上面 `sinceMs >= IDLE` 已经
   * 放行过闲档，走到这里就是还没攒够，直接挡回去 —— 于是关机期间恒定 30 分钟
   * 一轮，有没有人看着都一样。读不到电源（null）时不改变原来的行为。
   */
  if (on === false) return { run: false, sinceMs, online, open, power: on };

  if (online > 0) return { run: true, sinceMs, online, open, power: on };
  if (sinceMs < OPEN_TICK_INTERVAL_MS) return { run: false, sinceMs, online, open, power: on };
  return { run: open > 0, sinceMs, online, open, power: on };
}

let inflight: Promise<TickResult> | null = null;

/**
 * 同一 isolate 里只跑一轮：上一响的 tick 还没跑完（奖杯重爬能跑过一分钟）、这一响
 * 又过了门时，后来的搭前面那一轮的车。
 * 收尾时**只有条目还是自己**才把锁放掉，前一轮的收尾不会把后一轮的锁顺手清了。
 */
function tickOnce(env: Env): Promise<TickResult> {
  const current = inflight;
  if (current) return current;

  const promise = tick(env);
  inflight = promise;
  const release = () => {
    if (inflight === promise) inflight = null;
  };
  // 两个分支都接上，别让 finally 派生出一条没人接的拒绝
  promise.then(release, release);
  return promise;
}

async function tick(env: Env): Promise<TickResult> {
  const startedAt = Date.now();
  // 同步落一份给门，别等下面那个 await —— 它要挡的就是「KV 还没读到新值」那一响
  lastFullTickAt = startedAt;
  let playedGamesChanged = false;
  let trophiesChanged = false;
  let trophies: TrophiesReport | null = null;

  try {
    const [
      storedPlayedGamesFingerprint,
      storedTrophiesFingerprint,
      storedCatalog,
      storedPlayedGames,
      storedLibrary,
    ] = await Promise.all([
      env.COLLECTOR_KV.get(PLAYED_GAMES_FINGERPRINT_KEY),
      env.COLLECTOR_KV.get(TROPHIES_FINGERPRINT_KEY),
      env.COLLECTOR_KV.get(TROPHY_CATALOG_KEY, "json"),
      env.COLLECTOR_KV.get(PLAYED_GAMES_CACHE_KEY, "json"),
      env.COLLECTOR_KV.get(LIBRARY_CACHE_KEY, "json"),
      // 门读的就是这一枚。写在打 PSN 之前，所以它记的是「这轮开始过」而不是
      // 「这轮成功过」—— 上游持续故障时的重试节奏才跟基线一致。
      writeFullTickStartedAt(env.COLLECTOR_KV, startedAt),
    ]);
    const oldPlayedGamesFingerprint = storedPlayedGamesFingerprint;
    const oldTrophiesFingerprint = storedTrophiesFingerprint;
    const lastCatalog = asTrophyCatalog(storedCatalog);
    const playedCache = asPlayedGamesCache(storedPlayedGames);
    const libraryCache = asLibraryCache(storedLibrary);

    const hidden = hiddenTitleIds(env);
    const auth = new AuthSession(env);
    // 这三路失败会让整轮失败，各贴一个名字：上游不可用时日志里看得出是哪一路先撞上的
    const [rawPresence, summary] = await Promise.all([
      upstream("presence", () => fetchPresence(env, auth)),
      upstream("trophy-summary", () => fetchTrophySummary(env, auth)),
    ]);
    const presence =
      rawPresence.playing && hidden.has(rawPresence.playing.titleId)
        ? { ...rawPresence, playing: null }
        : rawPresence;

    const playing = presence.playing != null;
    // 在玩时的 TTL 对着闲档的完整 tick 节奏：快档下也不会每轮都去翻一遍分页列表。
    const playedTtlMs = playing ? PLAYED_GAMES_PLAYING_TTL_MS : PLAYED_GAMES_IDLE_TTL_MS;
    const playedFresh =
      playedCache != null && Date.now() - playedCache.fetchedAt < playedTtlMs;
    const libraryFresh =
      libraryCache != null && Date.now() - libraryCache.fetchedAt < LIBRARY_TTL_MS;
    const trophiesQuiet =
      lastCatalog != null &&
      lastCatalog.summarySignature === trophySummarySignature(hidden, summary) &&
      lastCatalog.fingerprint === oldTrophiesFingerprint;

    const refreshPlayed = !playedFresh;
    const refreshLibrary = !libraryFresh;
    const playedCap = trophiesQuiet ? playedGamesLimit(env) : Number.POSITIVE_INFINITY;

    let playedGames: PlayedGamesReport = playedCache?.report ?? { observedAt: Date.now(), items: [] };
    let library: LibraryTitle[] = libraryCache?.items ?? [];

    const extras: Promise<void>[] = [];
    if (refreshPlayed) {
      extras.push(
        (async () => {
          const fetched = await upstream("played-games", () => fetchPlayedGames(env, auth, playedCap));
          playedGames =
            Number.isFinite(playedCap) && playedCache
              ? mergePlayedGames(playedCache.report, fetched)
              : fetched;
          await writePlayedGamesCache(env.COLLECTOR_KV, { fetchedAt: Date.now(), report: playedGames });
          console.log(
            JSON.stringify({
              event: "playstation-played-games",
              cached: false,
              capped: Number.isFinite(playedCap),
              titles: playedGames.items.length,
            }),
          );
        })(),
      );
    } else {
      console.log(
        JSON.stringify({
          event: "playstation-played-games",
          cached: true,
          ageMs: playedCache ? Date.now() - playedCache.fetchedAt : 0,
          titles: playedGames.items.length,
        }),
      );
    }
    if (refreshLibrary) {
      extras.push(
        (async () => {
          try {
            library = await fetchPurchasedLibrary(env, auth);
            await writeLibraryCache(env.COLLECTOR_KV, { fetchedAt: Date.now(), items: library });
            console.log(
              JSON.stringify({
                event: "playstation-library",
                titles: library.length,
                preorders: library.filter((item) => item.preOrder).length,
                plus: library.filter((item) => item.membership === "PS_PLUS").length,
              }),
            );
          } catch (error) {
            // 购买库只是标预购 / Plus，失败沿用旧缓存；上游不可用单独记一类，别混进报错
            if (isUpstreamUnavailable(error)) logUpstreamUnavailable("library", error);
            else console.error(JSON.stringify({ event: "playstation-library", error: explain(error) }));
            if (!libraryCache) library = [];
          }
        })(),
      );
    } else {
      console.log(
        JSON.stringify({
          event: "playstation-library",
          cached: true,
          ageMs: libraryCache ? Date.now() - libraryCache.fetchedAt : 0,
          titles: library.length,
        }),
      );
    }
    if (extras.length) await Promise.all(extras);
    const overlaid = overlayLibrary(playedGames, library);
    const entitledPlayed = {
      ...overlaid,
      items: withoutHiddenTitleIds(overlaid.items, hidden),
    };
    const recentPlayedGames = withUnplayedPreorders(
      recentPlayed(entitledPlayed, env),
      entitledPlayed,
      withoutHiddenTitleIds(library, hidden),
    );
    const nextPlayedGamesFingerprint = playedGamesFingerprint(recentPlayedGames);
    playedGamesChanged = nextPlayedGamesFingerprint !== oldPlayedGamesFingerprint;

    // 两封信各交各的：一封被站点 400，不该把另一封的指纹也扣住不写。
    const failures: string[] = [];

    // presence 每个完整 tick 必发：站点靠这枚 observedAt 判 worker 死活，内容没变它自己压掉广播。
    // 排在奖杯前面：心跳便宜且关键，奖杯那半失败不该挡住这一封。
    try {
      await deliver(env, {
        version: 1,
        presence,
        ...(playedGamesChanged ? { playedGames: recentPlayedGames } : {}),
      });
      if (playedGamesChanged) {
        await env.COLLECTOR_KV.put(PLAYED_GAMES_FINGERPRINT_KEY, nextPlayedGamesFingerprint);
      }
    } catch (error) {
      failures.push(`presence 交付失败：${explain(error)}`);
      console.error(
        JSON.stringify({ event: "playstation-deliver", part: "presence", error: explain(error) }),
      );
    }

    try {
      const synced = await syncTrophies(
        env,
        auth,
        hidden,
        overlaid,
        oldTrophiesFingerprint,
        lastCatalog,
        summary,
      );
      trophies = synced.trophies;
      trophiesChanged = synced.trophiesChanged;
      if (trophiesChanged && trophies) {
        try {
          await deliver(env, { version: 1, trophies });
          await env.COLLECTOR_KV.put(TROPHIES_FINGERPRINT_KEY, synced.nextFingerprint);
          if (synced.catalog) await writeTrophyCatalog(env.COLLECTOR_KV, synced.catalog);
          // 交付成功之后才归档：D1 里只有状态核心真正收下的那份（已去掉屏蔽的游戏），失败只记日志
          if (env.HISTORY && !isDryRun(env)) await archiveTrophies(env.HISTORY, trophies);
        } catch (error) {
          failures.push(`trophies 交付失败：${explain(error)}`);
          console.error(
            JSON.stringify({
              event: "playstation-deliver",
              part: "trophies",
              error: explain(error),
            }),
          );
        }
      }
    } catch (error) {
      if (isUpstreamUnavailable(error)) logUpstreamUnavailable("trophies", error);
      else console.error(JSON.stringify({ event: "playstation-trophies", error: explain(error) }));
    }

    if (failures.length) throw new Error(failures.join("；"));

    const meta: TickMeta = {
      startedAt,
      completedAt: Date.now(),
      ok: true,
      playedGamesChanged,
      trophiesChanged,
      dryRun: isDryRun(env),
    };
    await env.COLLECTOR_KV.put(TICK_META_KEY, JSON.stringify(meta));
    await recordTickOutcome(env, null);
    console.log(JSON.stringify({ event: "playstation-tick", ...meta }));
    return { meta, presence, playedGames: recentPlayedGames, trophies };
  } catch (error) {
    const meta: TickMeta = {
      startedAt,
      completedAt: Date.now(),
      ok: false,
      playedGamesChanged,
      trophiesChanged,
      dryRun: isDryRun(env),
      error: explain(error),
    };
    await env.COLLECTOR_KV.put(TICK_META_KEY, JSON.stringify(meta));
    const backoff = await recordTickOutcome(env, error);
    if (error instanceof PsnUpstreamUnavailable) {
      logUpstreamUnavailable(error.call, error, backoff);
    } else {
      console.error(JSON.stringify({ event: "playstation-tick", ...meta }));
    }
    throw error;
  }
}

/**
 * 连败次数与退避截止时刻，isolate 本地这一份。道理和 `lastFullTickAt` 一样：KV 的读
 * 有最长 60 秒的边缘缓存，刚写下的退避下一分钟可能还读不到。两份各取较新的那一枚。
 */
let localStreak: FailureStreak = { streak: 0, at: 0 };
let localBackoffUntil = 0;

async function currentStreak(env: Env): Promise<FailureStreak> {
  const stored = await readFailureStreak(env.COLLECTOR_KV);
  return stored.at >= localStreak.at ? stored : localStreak;
}

/**
 * 一轮收尾时记账：成功清零连败和退避，失败连败加一；上游不可用再按连败次数退避
 * （时长见 state.ts 的 `backoffMs`）。只在值真的变了时写 KV。
 * 返回这次定下的退避时长，没退避是 0。
 */
async function recordTickOutcome(env: Env, error: unknown): Promise<number> {
  const now = Date.now();
  const previous = await currentStreak(env);
  if (error == null) {
    localStreak = { streak: 0, at: now };
    const stale = Math.max(localBackoffUntil, await readBackoffUntil(env.COLLECTOR_KV));
    localBackoffUntil = 0;
    await Promise.all([
      previous.streak !== 0 ? writeFailureStreak(env.COLLECTOR_KV, localStreak) : null,
      stale !== 0 ? writeBackoffUntil(env.COLLECTOR_KV, 0) : null,
    ]);
    return 0;
  }
  localStreak = { streak: previous.streak + 1, at: now };
  let wait = 0;
  if (error instanceof PsnUpstreamUnavailable) {
    wait = backoffMs(localStreak.streak);
    localBackoffUntil = now + wait;
  }
  await Promise.all([
    writeFailureStreak(env.COLLECTOR_KV, localStreak),
    wait ? writeBackoffUntil(env.COLLECTOR_KV, localBackoffUntil) : null,
  ]);
  return wait;
}

function logUpstreamUnavailable(call: string, error: unknown, backoffMs?: number): void {
  console.warn(JSON.stringify({
    event: "playstation-upstream-unavailable",
    call,
    error: explain(error).slice(0, 300),
    ...(backoffMs ? { backoffMs } : {}),
  }));
}

/**
 * 跳过的这一响要不要让 Sentry 监控报 error：连着失败两轮以上才算。单次抖动之后的
 * 等待（闲档、退避）照常报 ok；持续断流时每次报到都是 error，
 * 监控连续两次 error 开 issue。真跑了的那一响失败了就直接报 error。
 */
function failingSince(streak: FailureStreak): Pick<JobResult, "failing"> {
  return streak.streak >= 2 ? { failing: `PSN 已连续 ${streak.streak} 轮失败` } : {};
}

/**
 * cron 每分钟一响，真跑哪一响由退避和 `shouldTick` 定（按人头数分三档）。
 * 被挡下的那一响什么都不做。
 * 手动触发（RPC、本地调试）也走同一道门：PSN 的登录每续一次就轮换 refresh token，
 * 不给任何入口开「不看门」的口子。
 */
export async function runPlaystation(env: Env): Promise<JobResult> {
  // 没有 NPSSO，KV 里也没有登录：本地开发和从没登录过的环境，干净地跳过
  if (!env.PSN_NPSSO?.trim() && !(await readAuth(env.COLLECTOR_KV))) {
    return skipMissing("playstation", ["PSN_NPSSO"]);
  }

  const backoffUntil = Math.max(await readBackoffUntil(env.COLLECTOR_KV), localBackoffUntil);
  if (Date.now() < backoffUntil) {
    const until = new Date(backoffUntil).toISOString();
    console.log(JSON.stringify({ event: "playstation-backoff", until }));
    return { status: "skipped", detail: `backoff until ${until}`, ...failingSince(await currentStreak(env)) };
  }

  const { run, sinceMs, online, open } = await shouldTick(env);
  console.log(
    JSON.stringify({
      event: "playstation-tick-gate",
      run,
      online,
      open,
      sinceMs: Number.isFinite(sinceMs) ? sinceMs : null,
    }),
  );
  if (!run) return { status: "skipped", detail: "gate closed", ...failingSince(await currentStreak(env)) };

  const { meta } = await tickOnce(env);
  return ok(meta.playedGamesChanged || meta.trophiesChanged ? "changed" : undefined);
}

export const playstationJob: Job = {
  name: "playstation",
  everyMinutes: 1,
  offset: 0,
  // 奖杯整份重爬（清过 KV、换了账号）能跑好几分钟
  maxRuntimeMinutes: 10,
  // 门里的在线人数只给 `COUNT_TIMEOUT_MS`，别和同一响里别的任务抢连接
  headStart: true,
  run: ({ env }) => runPlaystation(env),
};

/** 测试之间把 isolate 本地的门、退避和连败清掉 */
export function resetPlaystationForTests(): void {
  lastFullTickAt = 0;
  inflight = null;
  localStreak = { streak: 0, at: 0 };
  localBackoffUntil = 0;
}
