import { AuthSession } from "./auth";
import { isDryRun, type Env } from "./env";
import {
  fetchPlayedGames,
  fetchPresence,
  type PlayedGamesReport,
  type PresenceReport,
} from "./psn";
import { deliver, type PlaystationEnvelope } from "./site";
import {
  PLAYED_GAMES_FINGERPRINT_KEY,
  PRESENCE_FINGERPRINT_KEY,
  TICK_META_KEY,
  type TickMeta,
} from "./state";

function presenceFingerprint(report: PresenceReport): string {
  const { observedAt: _observedAt, ...content } = report;
  return JSON.stringify(content);
}

function playedGamesFingerprint(report: PlayedGamesReport): string {
  return JSON.stringify(report.items);
}

function explain(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type TickResult = {
  meta: TickMeta;
  presence: PresenceReport;
  playedGames: PlayedGamesReport;
};

async function tick(env: Env): Promise<TickResult> {
  const startedAt = Date.now();
  let presenceChanged = false;
  let playedGamesChanged = false;

  try {
    const [oldPresenceFingerprint, oldPlayedGamesFingerprint] = await Promise.all([
      env.STATE.get(PRESENCE_FINGERPRINT_KEY),
      env.STATE.get(PLAYED_GAMES_FINGERPRINT_KEY),
    ]);

    // 两个业务端点严格顺序执行，共享这一轮 invocation 内唯一的 AuthSession。
    const auth = new AuthSession(env);
    const presence = await fetchPresence(env, auth);
    const playedGames = await fetchPlayedGames(env, auth);
    const nextPresenceFingerprint = presenceFingerprint(presence);
    const nextPlayedGamesFingerprint = playedGamesFingerprint(playedGames);
    presenceChanged = nextPresenceFingerprint !== oldPresenceFingerprint;
    playedGamesChanged = nextPlayedGamesFingerprint !== oldPlayedGamesFingerprint;

    if (presenceChanged || playedGamesChanged) {
      const envelope: PlaystationEnvelope = {
        version: 1,
        ...(presenceChanged ? { presence } : {}),
        ...(playedGamesChanged ? { playedGames } : {}),
      };
      await deliver(env, envelope);

      // 只有信封成功交付（或 dry-run 成功打印）后才推进指纹，失败留给下轮重试。
      const writes: Promise<void>[] = [];
      if (presenceChanged) {
        writes.push(env.STATE.put(PRESENCE_FINGERPRINT_KEY, nextPresenceFingerprint));
      }
      if (playedGamesChanged) {
        writes.push(env.STATE.put(PLAYED_GAMES_FINGERPRINT_KEY, nextPlayedGamesFingerprint));
      }
      await Promise.all(writes);
    }

    const meta: TickMeta = {
      startedAt,
      completedAt: Date.now(),
      ok: true,
      presenceChanged,
      playedGamesChanged,
      dryRun: isDryRun(env),
    };
    await env.STATE.put(TICK_META_KEY, JSON.stringify(meta));
    console.log(JSON.stringify({ event: "playstation-tick", ...meta }));
    return { meta, presence, playedGames };
  } catch (error) {
    const meta: TickMeta = {
      startedAt,
      completedAt: Date.now(),
      ok: false,
      presenceChanged,
      playedGamesChanged,
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
    await tick(env);
  },

  /**
   * 手动触发，和 cache-warmup 同一个模式：GET / 就是把一轮 tick 完整跑一遍
   * （拉 PSN、比指纹、变了才交付），把这一轮的结果和抓到的数据一并返回。
   * 这里不做鉴权 —— 访问控制由前面的 Cloudflare Access 负责。token 永远不出现在响应里。
   */
  async fetch(request, env) {
    if (request.method !== "GET") {
      return Response.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
    }
    // 只认根路径：浏览器打开页面会顺手再要一个 /favicon.ico，不拦下它的话
    // 一次访问就变成两轮 tick、两次 PSN 轮询
    if (new URL(request.url).pathname !== "/") {
      return Response.json({ ok: false, error: "Not Found" }, { status: 404 });
    }
    try {
      const { meta, presence, playedGames } = await tick(env);
      return Response.json({ ...meta, presence, playedGames });
    } catch (error) {
      const meta = await env.STATE.get<TickMeta>(TICK_META_KEY, "json");
      return Response.json(
        { ok: false, error: explain(error), lastTick: meta },
        { status: 502 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
