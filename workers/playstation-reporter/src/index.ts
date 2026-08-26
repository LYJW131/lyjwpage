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
  overlayLibrary,
  withUnplayedPreorders,
  type LibraryTitle,
  type PlayedGamesReport,
  type PresenceReport,
} from "./psn";
import { deliver } from "./site";
import {
  PLAYED_GAMES_FINGERPRINT_KEY,
  TICK_META_KEY,
  TROPHIES_FINGERPRINT_KEY,
  TROPHY_SYNC_KEY,
  asTrophySync,
  clearTrophySync,
  writeTrophySync,
  type TickMeta,
  type TrophySyncProgress,
  type TrophySyncState,
} from "./state";
import {
  PLAY_LINK_BATCHES_PER_TICK,
  TROPHY_TITLES_PER_TICK,
  buildTrophiesReport,
  fetchTrophyIndex,
  fetchTrophyTitleSlice,
  mapPlayByTrophySlice,
  mergePlayByTrophy,
  playLinkGames,
  type TrophiesReport,
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

function syncProgress(sync: TrophySyncState): TrophySyncProgress {
  return { done: sync.nextIndex, total: sync.titleIds.length };
}

function newTrophySync(targetFingerprint: string, titleIds: string[]): TrophySyncState {
  return { targetFingerprint, titleIds, nextIndex: 0, titles: [] };
}

/**
 * 奖杯只在整份齐了才交给 deliver。分片结果进 KV 游标，不进站点。
 */
async function syncTrophies(
  env: Env,
  auth: AuthSession,
  hidden: Set<string>,
  overlaid: PlayedGamesReport,
  oldTrophiesFingerprint: string | null,
  stored: unknown,
): Promise<{
  trophies: TrophiesReport | null;
  trophiesChanged: boolean;
  nextFingerprint: string;
  trophySync?: TrophySyncProgress;
}> {
  const index = await fetchTrophyIndex(env, auth);
  const nextFingerprint = trophiesFingerprintOf(hidden, index.fingerprint);

  if (nextFingerprint === oldTrophiesFingerprint) {
    if (asTrophySync(stored)) await clearTrophySync(env.STATE);
    return { trophies: null, trophiesChanged: false, nextFingerprint };
  }

  let sync = asTrophySync(stored);
  if (!sync || sync.targetFingerprint !== nextFingerprint) {
    // 目标指纹对不上就整份丢掉重来：半份目录混了两个时点，交出去是假目录。
    if (sync) {
      console.log(
        JSON.stringify({
          event: "playstation-trophy-sync",
          action: "rebuild",
          previous: sync.targetFingerprint,
        }),
      );
    }
    sync = newTrophySync(
      nextFingerprint,
      index.titles.map((title) => title.npCommunicationId),
    );
  }

  if (sync.nextIndex < sync.titleIds.length) {
    const byId = new Map(index.titles.map((title) => [title.npCommunicationId, title]));
    const sliceIds = sync.titleIds.slice(sync.nextIndex, sync.nextIndex + TROPHY_TITLES_PER_TICK);
    const slice = [];
    for (const id of sliceIds) {
      const title = byId.get(id);
      if (!title) throw new Error(`奖杯目录少了 ${id}`);
      slice.push(title);
    }
    const crawled = await fetchTrophyTitleSlice(env, auth, slice);
    sync = {
      ...sync,
      nextIndex: sync.nextIndex + crawled.length,
      titles: [...sync.titles, ...crawled],
    };
    await writeTrophySync(env.STATE, sync);
    console.log(
      JSON.stringify({ event: "playstation-trophy-sync", action: "crawl", ...syncProgress(sync) }),
    );
    // 这一片刚写完就停：组装还要打资料和对齐，跟 6 款明细叠一轮会顶满 50。
    return {
      trophies: null,
      trophiesChanged: false,
      nextFingerprint,
      trophySync: syncProgress(sync),
    };
  }

  let playLink = sync.playLink;
  if (!playLink) playLink = { games: playLinkGames(overlaid), offset: 0, byTrophy: {} };

  if (playLink.offset < playLink.games.length) {
    const mapped = await mapPlayByTrophySlice(
      env,
      auth,
      playLink.games,
      playLink.offset,
      PLAY_LINK_BATCHES_PER_TICK,
    );
    playLink = {
      ...playLink,
      offset: mapped.nextOffset,
      byTrophy: mergePlayByTrophy(playLink.byTrophy, mapped.byTrophy),
    };
    sync = { ...sync, playLink };
    await writeTrophySync(env.STATE, sync);
    console.log(
      JSON.stringify({
        event: "playstation-trophy-sync",
        action: "link",
        ...syncProgress(sync),
        playLinked: playLink.offset,
        playTotal: playLink.games.length,
      }),
    );
    if (playLink.offset < playLink.games.length) {
      return {
        trophies: null,
        trophiesChanged: false,
        nextFingerprint,
        trophySync: syncProgress(sync),
      };
    }
  }

  const fetched = await buildTrophiesReport(env, auth, index, sync.titles, playLink.byTrophy);
  const trophies = hidden.size
    ? {
        ...fetched,
        titles: fetched.titles.filter((title) => !titleIdsHidden(title.titleIds, hidden)),
      }
    : fetched;
  return {
    trophies,
    trophiesChanged: true,
    nextFingerprint,
    trophySync: syncProgress(sync),
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
  let trophySync: TickMeta["trophySync"];

  try {
    const [oldPlayedGamesFingerprint, oldTrophiesFingerprint, storedTrophySync] = await Promise.all([
      env.STATE.get(PLAYED_GAMES_FINGERPRINT_KEY),
      env.STATE.get(TROPHIES_FINGERPRINT_KEY),
      env.STATE.get(TROPHY_SYNC_KEY, "json"),
    ]);
    const existingSync = asTrophySync(storedTrophySync);
    if (existingSync) trophySync = syncProgress(existingSync);

    const hidden = hiddenTitleIds(env);
    const auth = new AuthSession(env);
    const rawPresence = await fetchPresence(env, auth);
    const presence =
      rawPresence.playing && hidden.has(rawPresence.playing.titleId)
        ? { ...rawPresence, playing: null }
        : rawPresence;
    const playedGames = await fetchPlayedGames(env, auth);
    let library: LibraryTitle[] = [];
    try {
      library = await fetchPurchasedLibrary(env, auth);
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
    }
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
    // 必须排在奖杯爬取**之前**：那边是每款游戏好几次 PSN 调用，免费版一次调用
    // 只有 50 个子请求，先爬再发的话预算烧穿，连这一枚 fetch 都发不出去 ——
    // 便宜且关键的先走，贵的那半自己兜自己的错。
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
        storedTrophySync,
      );
      trophies = synced.trophies;
      trophiesChanged = synced.trophiesChanged;
      trophySync = synced.trophySync;
      if (trophiesChanged && trophies) {
        try {
          await deliver(env, { version: 1, trophies });
          await env.STATE.put(TROPHIES_FINGERPRINT_KEY, synced.nextFingerprint);
          await clearTrophySync(env.STATE);
          trophySync = undefined;
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
      ...(trophySync ? { trophySync } : {}),
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
      ...(trophySync ? { trophySync } : {}),
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
