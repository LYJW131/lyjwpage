import { AuthSession } from "./auth";
import { isDryRun, playedGamesLimit, type Env } from "./env";
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
import { deliver, type PlaystationEnvelope } from "./site";
import {
  PLAYED_GAMES_FINGERPRINT_KEY,
  PRESENCE_FINGERPRINT_KEY,
  TICK_META_KEY,
  TROPHIES_FINGERPRINT_KEY,
  type TickMeta,
} from "./state";
import { fetchTrophies, fetchTrophyIndex, type TrophiesReport } from "./trophies";

function presenceFingerprint(report: PresenceReport): string {
  const { observedAt: _observedAt, ...content } = report;
  return JSON.stringify(content);
}

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
  let presenceChanged = false;
  let playedGamesChanged = false;
  let trophiesChanged = false;
  let trophies: TrophiesReport | null = null;

  try {
    const [oldPresenceFingerprint, oldPlayedGamesFingerprint, oldTrophiesFingerprint] =
      await Promise.all([
        env.STATE.get(PRESENCE_FINGERPRINT_KEY),
        env.STATE.get(PLAYED_GAMES_FINGERPRINT_KEY),
        env.STATE.get(TROPHIES_FINGERPRINT_KEY),
      ]);

    const auth = new AuthSession(env);
    const presence = await fetchPresence(env, auth);
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
    const entitledPlayed = overlayLibrary(playedGames, library);
    const recentPlayedGames = withUnplayedPreorders(
      recentPlayed(entitledPlayed, env),
      entitledPlayed,
      library,
    );
    const nextPresenceFingerprint = presenceFingerprint(presence);
    const nextPlayedGamesFingerprint = playedGamesFingerprint(recentPlayedGames);
    presenceChanged = nextPresenceFingerprint !== oldPresenceFingerprint;
    playedGamesChanged = nextPlayedGamesFingerprint !== oldPlayedGamesFingerprint;

    let nextTrophiesFingerprint = oldTrophiesFingerprint;
    try {
      const index = await fetchTrophyIndex(env, auth);
      nextTrophiesFingerprint = index.fingerprint;
      if (index.fingerprint !== oldTrophiesFingerprint) {
        trophies = await fetchTrophies(env, auth, entitledPlayed, index);
        trophiesChanged = true;
      }
    } catch (error) {
      console.error(
        JSON.stringify({ event: "playstation-trophies", error: explain(error) }),
      );
    }

    if (presenceChanged || playedGamesChanged || trophiesChanged) {
      const envelope: PlaystationEnvelope = {
        version: 1,
        ...(presenceChanged ? { presence } : {}),
        ...(playedGamesChanged ? { playedGames: recentPlayedGames } : {}),
        ...(trophiesChanged && trophies ? { trophies } : {}),
      };
      await deliver(env, envelope);

      const writes: Promise<void>[] = [];
      if (presenceChanged) {
        writes.push(env.STATE.put(PRESENCE_FINGERPRINT_KEY, nextPresenceFingerprint));
      }
      if (playedGamesChanged) {
        writes.push(env.STATE.put(PLAYED_GAMES_FINGERPRINT_KEY, nextPlayedGamesFingerprint));
      }
      if (trophiesChanged && nextTrophiesFingerprint) {
        writes.push(env.STATE.put(TROPHIES_FINGERPRINT_KEY, nextTrophiesFingerprint));
      }
      await Promise.all(writes);
    }

    const meta: TickMeta = {
      startedAt,
      completedAt: Date.now(),
      ok: true,
      presenceChanged,
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
      presenceChanged,
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
