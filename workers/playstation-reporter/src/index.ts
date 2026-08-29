import { AuthSession } from "./auth";
import {
  hiddenTitleIds,
  isDryRun,
  liveCountUrl,
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
import { deliver } from "./site";
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
  TROPHY_SYNC_KEY,
  asLibraryCache,
  asPlayedGamesCache,
  asTrophyCatalog,
  readFullTickStartedAt,
  writeFullTickStartedAt,
  writeLibraryCache,
  writePlayedGamesCache,
  writeTrophyCatalog,
  type TickMeta,
  type TrophyCatalog,
} from "./state";
import {
  buildTrophiesReport,
  dirtyIndexRows,
  fetchTrophySummary,
  fetchTrophyTitleSlice,
  fetchTrophyTitles,
  indexFingerprint,
  mapPlayByTrophy,
  mergePlayByTrophy,
  mergeTrophyTitles,
  playByTrophyFromTitles,
  playLinkGames,
  snapshotIndex,
  trophySummarySignature,
  type TrophiesReport,
  type TrophySummary,
} from "./trophies";

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

/**
 * 奖杯只在整份齐了才交给 deliver。没变的标题从上次交付的目录合并，不重打 PSN。
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

  if (last && last.summarySignature === summarySignature && last.fingerprint === oldTrophiesFingerprint) {
    console.log(JSON.stringify({ event: "playstation-trophy-sync", action: "skip" }));
    return { trophies: null, trophiesChanged: false, nextFingerprint: last.fingerprint };
  }

  const titles = await fetchTrophyTitles(env, auth);
  const nextFingerprint = trophiesFingerprintOf(hidden, indexFingerprint(titles, summary));
  if (nextFingerprint === oldTrophiesFingerprint && last) {
    return { trophies: null, trophiesChanged: false, nextFingerprint };
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

  const fetched = await buildTrophiesReport(
    env,
    auth,
    summary,
    merged,
    byTrophy,
    crawled.length === 0 ? last?.profile : null,
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
      profile: fetched.profile,
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
 * 站点有页面开着时的完整 tick 间隔：60 秒。cron 每分钟一响，卡 60 秒整的话早响
 * 半秒的那一轮会被门挡掉、实际退化成两分钟一轮，所以留 5 秒余量。
 *
 * 门读的是 live-push 的连接数，所以「有人」的口径是**页面开着**（含后台标签页、
 * 锁了屏的手机），比「此刻正盯着」命中的时长长得多 —— 一个标签页挂着不关就是一天
 * 1440 次 PSN 请求。这是明摆着的取舍：presence 的新鲜度按「有没有人可能切回来看」
 * 算，而一个页面都没开的那段时间仍然一分钱不多花。
 */
const LIVE_TICK_INTERVAL_MS = 55_000;
/**
 * 一个页面都没开着时的完整 tick 间隔。同样留取整余量：每分钟的 cron 把它凑成
 * 15 分钟整一轮，和从前那根十五分钟的 cron 一模一样，闲时对 PSN 的流量不变。
 *
 * 站点 `src/lib/freshness.ts` 的 `PLAYSTATION_STALE_MS`（50 分钟 = 三轮 + 余量）
 * 锚的就是这个数。要动它，先去改那边。
 */
const IDLE_TICK_INTERVAL_MS = 14.5 * 60_000;
/** 连接数读不回来不该拖着 tick 等，超时就当一个都没有。 */
const LIVE_COUNT_TIMEOUT_MS = 2_500;

/**
 * 此刻挂在 live-push 上的连接数，也就是**开着**本站的页面数。超时、非 200、
 * 形状不对，一律当 0。
 *
 * 读的是 live-push 不是 online-counter：后者在页面进后台时整条连接关掉，数的是
 * 「此刻可见」，切个标签页、锁个屏就掉成 0，门跟着来回抖。上报该不该保持新鲜，
 * 取决于「有人可能切回来看」，那正是 live-push 这条连接活着的含义。
 *
 * 兜底方向是单向的：读不到只会让节奏退回基线，永远不会因为故障变快 ——
 * 认错方向的代价是每分钟撞一次 PSN。
 */
async function liveConnections(env: Env): Promise<number> {
  const url = liveCountUrl(env);
  if (!url) return 0;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(LIVE_COUNT_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`返回 ${response.status}`);
    const body = (await response.json()) as { connections?: unknown } | null;
    const value = Number(body?.connections);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  } catch (error) {
    console.warn(JSON.stringify({ event: "playstation-live-count", error: explain(error) }));
    return 0;
  }
}

/**
 * 上一轮完整 tick 的开始时刻，isolate 本地这一份。
 *
 * KV 的读有最长 60 秒的边缘缓存，而门的阈值正好在这个量级上：相邻两响里后一响
 * 可能还拿着写入之前的旧值，把同一轮放行两次。cron 每分钟一响，相邻两响多半落在
 * 同一个 isolate 上，所以和 KV 那份取较晚的一枚就能挡掉这种重复。两份记的都是
 * 真实发生过的开始时刻，取晚的不会误挡；isolate 冷起时它是 0，退回纯 KV 判断。
 */
let lastFullTickAt = 0;

/**
 * cron 每分钟一响，这道门决定这一响要不要真跑一轮。
 *
 * 门里只有两个读操作（KV 一枚时间戳 + live-push 的连接数），都排在任何贵操作之前：
 * 被挡下的那一轮完全不碰 PSN、不碰站点。间隔算的是**上一轮开始**的时刻而不是成功的
 * 时刻 —— 否则 PSN 持续故障时，重试会从十五分钟一次恶化成每分钟一次。
 */
async function shouldTick(
  env: Env,
): Promise<{ run: boolean; sinceMs: number; connections: number | null }> {
  const lastAt = Math.max(await readFullTickStartedAt(env.STATE), lastFullTickAt);
  const sinceMs = lastAt > 0 ? Date.now() - lastAt : Number.POSITIVE_INFINITY;
  // 攒够基线间隔就必跑，不必再问连接数：闲时节奏不该依赖另一个 worker 可不可达
  if (sinceMs >= IDLE_TICK_INTERVAL_MS) return { run: true, sinceMs, connections: null };
  if (sinceMs < LIVE_TICK_INTERVAL_MS) return { run: false, sinceMs, connections: null };
  const connections = await liveConnections(env);
  return { run: connections > 0, sinceMs, connections };
}

let inflight: Promise<TickResult> | null = null;

/** 同一 isolate 里只跑一轮。本地 8788 会被 Chrome 探 /json/version 再连打 GET /。 */
function tickOnce(env: Env): Promise<TickResult> {
  inflight ??= tick(env).finally(() => {
    inflight = null;
  });
  return inflight;
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
      oldPlayedGamesFingerprint,
      oldTrophiesFingerprint,
      storedCatalog,
      storedPlayedGames,
      storedLibrary,
    ] = await Promise.all([
      env.STATE.get(PLAYED_GAMES_FINGERPRINT_KEY),
      env.STATE.get(TROPHIES_FINGERPRINT_KEY),
      env.STATE.get(TROPHY_CATALOG_KEY, "json"),
      env.STATE.get(PLAYED_GAMES_CACHE_KEY, "json"),
      env.STATE.get(LIBRARY_CACHE_KEY, "json"),
      env.STATE.delete(TROPHY_SYNC_KEY),
      // 门读的就是这一枚。写在打 PSN 之前，所以它记的是「这轮开始过」而不是
      // 「这轮成功过」—— 上游持续故障时的重试节奏才跟基线一致。
      writeFullTickStartedAt(env.STATE, startedAt),
    ]);
    const lastCatalog = asTrophyCatalog(storedCatalog);
    const playedCache = asPlayedGamesCache(storedPlayedGames);
    const libraryCache = asLibraryCache(storedLibrary);

    const hidden = hiddenTitleIds(env);
    const auth = new AuthSession(env);
    const [rawPresence, summary] = await Promise.all([
      fetchPresence(env, auth),
      fetchTrophySummary(env, auth),
    ]);
    const presence =
      rawPresence.playing && hidden.has(rawPresence.playing.titleId)
        ? { ...rawPresence, playing: null }
        : rawPresence;

    const playing = presence.playing != null;
    // 在玩时的 TTL 对着闲时那档完整 tick 节奏：从前「在玩每轮刷」那会儿一轮正好
    // 15 分钟，这里维持同一个节奏，快节奏下也不会每分钟去翻一遍分页列表。
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
          const fetched = await fetchPlayedGames(env, auth, playedCap);
          playedGames =
            Number.isFinite(playedCap) && playedCache
              ? mergePlayedGames(playedCache.report, fetched)
              : fetched;
          await writePlayedGamesCache(env.STATE, { fetchedAt: Date.now(), report: playedGames });
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
            await writeLibraryCache(env.STATE, { fetchedAt: Date.now(), items: library });
            console.log(
              JSON.stringify({
                event: "playstation-library",
                titles: library.length,
                preorders: library.filter((item) => item.preOrder).length,
                plus: library.filter((item) => item.membership === "PS_PLUS").length,
              }),
            );
          } catch (error) {
            console.error(
              JSON.stringify({ event: "playstation-library", error: explain(error) }),
            );
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

    // presence 每轮必发：站点靠这枚 observedAt 判 worker 死活，内容没变它自己压掉广播。
    // 排在奖杯前面：心跳便宜且关键，奖杯那半失败不该挡住这一封。
    try {
      await deliver(env, {
        version: 1,
        presence,
        ...(playedGamesChanged ? { playedGames: recentPlayedGames } : {}),
      });
      if (playedGamesChanged) {
        await env.STATE.put(PLAYED_GAMES_FINGERPRINT_KEY, nextPlayedGamesFingerprint);
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
          await env.STATE.put(TROPHIES_FINGERPRINT_KEY, synced.nextFingerprint);
          if (synced.catalog) await writeTrophyCatalog(env.STATE, synced.catalog);
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
      console.error(
        JSON.stringify({ event: "playstation-trophies", error: explain(error) }),
      );
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
    await env.STATE.put(TICK_META_KEY, JSON.stringify(meta));
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
    await env.STATE.put(TICK_META_KEY, JSON.stringify(meta));
    console.error(JSON.stringify({ event: "playstation-tick", ...meta }));
    throw error;
  }
}

export default {
  /**
   * cron 每分钟一响，真跑哪一响由 `shouldTick` 定：站点有页面开着 60 秒一轮，
   * 一个都没有 15 分钟一轮。被挡下的那一响什么都不做。
   */
  async scheduled(_controller, env) {
    const { run, sinceMs, connections } = await shouldTick(env);
    console.log(
      JSON.stringify({
        event: "playstation-tick-gate",
        run,
        connections,
        sinceMs: Number.isFinite(sinceMs) ? sinceMs : null,
      }),
    );
    if (!run) return;
    await tickOnce(env);
  },

  /**
   * 手动触发走 GET /tick，不挂在 GET / 上。Chrome / Cursor 会拿调试口探
   * `/json/version` 再打 GET /，根路径一跑 tick 就会连着撞 PSN。
   * 访问控制仍由前面的 Cloudflare Access 负责。token 永远不出现在响应里。
   *
   * `/tick` 不走门：它是调试工具，要的就是「现在立刻跑一轮」。它照样会刷新
   * 那枚开始时刻，所以手动跑完一轮之后，下一轮定时的也跟着往后顺延。
   */
  async fetch(request, env) {
    if (request.method !== "GET") {
      return Response.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
    }
    const path = new URL(request.url).pathname;
    if (path === "/") {
      const meta = await env.STATE.get<TickMeta>(TICK_META_KEY, "json");
      return Response.json(meta ?? { ok: false, error: "还没跑过一轮" });
    }
    if (path !== "/tick") {
      return Response.json({ ok: false, error: "Not Found" }, { status: 404 });
    }
    try {
      const { meta, presence, playedGames, trophies } = await tickOnce(env);
      return Response.json({
        ...meta,
        presence,
        playedGames,
        trophies: trophies
          ? {
              observedAt: trophies.observedAt,
              level: trophies.profile.level,
              earned: trophies.profile.earned,
              titleCount: trophies.titles.length,
            }
          : null,
      });
    } catch (error) {
      const meta = await env.STATE.get<TickMeta>(TICK_META_KEY, "json");
      return Response.json(
        { ok: false, error: explain(error), lastTick: meta },
        { status: 502 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
