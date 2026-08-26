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
  type TickMeta,
} from "./state";
import { fetchTrophies, fetchTrophyIndex, type TrophiesReport } from "./trophies";

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
    const [oldPlayedGamesFingerprint, oldTrophiesFingerprint] = await Promise.all([
      env.STATE.get(PLAYED_GAMES_FINGERPRINT_KEY),
      env.STATE.get(TROPHIES_FINGERPRINT_KEY),
    ]);

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

    let nextTrophiesFingerprint = oldTrophiesFingerprint;
    try {
      const index = await fetchTrophyIndex(env, auth);
      // 屏蔽名单也进指纹：改 ID 才会重推目录，把旧 Redis 里的那几款换掉。
      nextTrophiesFingerprint = JSON.stringify({
        hidden: [...hidden].sort(),
        drop: "after-link",
        body: index.fingerprint,
      });
      if (nextTrophiesFingerprint !== oldTrophiesFingerprint) {
        // 对齐必须看见完整游玩列表，否则屏蔽的 titleId 对不上、空 titleIds 会漏出去。
        const fetched = await fetchTrophies(env, auth, overlaid, index);
        trophies = hidden.size
          ? {
              ...fetched,
              titles: fetched.titles.filter((title) => !titleIdsHidden(title.titleIds, hidden)),
            }
          : fetched;
        trophiesChanged = true;
      }
    } catch (error) {
      console.error(
        JSON.stringify({ event: "playstation-trophies", error: explain(error) }),
      );
    }

    if (trophiesChanged && trophies && nextTrophiesFingerprint) {
      try {
        await deliver(env, { version: 1, trophies });
        await env.STATE.put(TROPHIES_FINGERPRINT_KEY, nextTrophiesFingerprint);
      } catch (error) {
        failures.push(`trophies 交付失败：${explain(error)}`);
        console.error(
          JSON.stringify({ event: "playstation-deliver", part: "trophies", error: explain(error) }),
        );
      }
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
