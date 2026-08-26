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
import { deliver } from "./site";
import {
  LIBRARY_CACHE_KEY,
  LIBRARY_TTL_MS,
  PLAYED_GAMES_CACHE_KEY,
  PLAYED_GAMES_FINGERPRINT_KEY,
  PLAYED_GAMES_TTL_MS,
  TICK_META_KEY,
  TROPHIES_FINGERPRINT_KEY,
  TROPHY_CATALOG_KEY,
  TROPHY_SYNC_KEY,
  asLibraryCache,
  asPlayedGamesCache,
  asTrophyCatalog,
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
    const playedFresh =
      playedCache != null && Date.now() - playedCache.fetchedAt < PLAYED_GAMES_TTL_MS;
    const libraryFresh =
      libraryCache != null && Date.now() - libraryCache.fetchedAt < LIBRARY_TTL_MS;
    const trophiesQuiet =
      lastCatalog != null &&
      lastCatalog.summarySignature === trophySummarySignature(hidden, summary) &&
      lastCatalog.fingerprint === oldTrophiesFingerprint;

    const refreshPlayed = playing || !playedFresh;
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
  async scheduled(_controller, env) {
    await tickOnce(env);
  },

  /**
   * 手动触发走 GET /tick，不挂在 GET / 上。Chrome / Cursor 会拿调试口探
   * `/json/version` 再打 GET /，根路径一跑 tick 就会连着撞 PSN。
   * 访问控制仍由前面的 Cloudflare Access 负责。token 永远不出现在响应里。
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
