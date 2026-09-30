import { AuthSession } from "./auth.js";
import { powerClass, shouldRunTick, type ConsolePower } from "./cadence.js";
import {
  hiddenTitleIds,
  isDryRun,
  playedGamesLimit,
  titleIdsHidden,
  withoutHiddenTitleIds,
  type Env,
} from "./env.js";
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
} from "./psn.js";
import { deliver } from "./site.js";
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
  readPowerClass,
  writeBackoffUntil,
  writeFailureStreak,
  writeFullTickStartedAt,
  writePowerClass,
  writeLibraryCache,
  writePlayedGamesCache,
  writeTrophyCatalog,
  type FailureStreak,
  type TickMeta,
  type TrophyCatalog,
} from "./state.js";
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
} from "./trophies.js";
import { PsnUpstreamUnavailable, isUpstreamUnavailable, upstream } from "./util.js";

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
    // 头像和 Plus 不在奖杯指纹里，即使目录未变也必须按资料 TTL 刷新。
    return refreshStoredProfile(env, auth, hidden, last, summary, last.fingerprint, summarySignature);
  }

  const titles = await fetchTrophyTitles(env, auth);
  const nextFingerprint = trophiesFingerprintOf(hidden, indexFingerprint(titles, summary));
  // 缓存目录与指纹必须同代，否则旧目录会覆盖已经上报的新解锁。
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

let lastFullTickAt = 0;
let localPowerClass: ReturnType<typeof powerClass> | null = null;

type Gate = {
  run: boolean;
  sinceMs: number;
  power: ConsolePower;
};

async function shouldTick(env: Env, power: ConsolePower): Promise<Gate> {
  const lastAt = Math.max(await readFullTickStartedAt(env.STATE), lastFullTickAt);
  const sinceMs = lastAt > 0 ? Date.now() - lastAt : Number.POSITIVE_INFINITY;
  const powerAtLastTick = localPowerClass ?? await readPowerClass(env.STATE);
  return { run: shouldRunTick({ sinceMs, power, powerAtLastTick }), sinceMs, power };
}

let inflight: Promise<TickResult> | null = null;

function tickOnce(env: Env, power: ConsolePower): Promise<TickResult> {
  const current = inflight;
  if (current) return current;

  const promise = tick(env, power);
  inflight = promise;
  const release = () => {
    if (inflight === promise) inflight = null;
  };
  // 两个分支都接上，别让 finally 派生出一条没人接的拒绝
  promise.then(release, release);
  return promise;
}

async function tick(env: Env, power: ConsolePower): Promise<TickResult> {
  const startedAt = Date.now();
  // 必须在首个 await 前更新内存闸，堵住磁盘尚未反映新时间戳时的重复放行。
  lastFullTickAt = startedAt;
  localPowerClass = powerClass(power);
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
      env.STATE.get(PLAYED_GAMES_FINGERPRINT_KEY),
      env.STATE.get(TROPHIES_FINGERPRINT_KEY),
      env.STATE.get(TROPHY_CATALOG_KEY, "json"),
      env.STATE.get(PLAYED_GAMES_CACHE_KEY, "json"),
      env.STATE.get(LIBRARY_CACHE_KEY, "json"),
      // 节流从尝试开始计时；只记成功会让持续故障退化为每次探测都重试。
      writeFullTickStartedAt(env.STATE, startedAt),
      writePowerClass(env.STATE, powerClass(power)),
    ]);
    const oldPlayedGamesFingerprint = storedPlayedGamesFingerprint;
    const oldTrophiesFingerprint = storedTrophiesFingerprint;
    const lastCatalog = asTrophyCatalog(storedCatalog);
    const playedCache = asPlayedGamesCache(storedPlayedGames);
    const libraryCache = asLibraryCache(storedLibrary);

    const hidden = hiddenTitleIds(env);
    const auth = new AuthSession(env);
    const [rawPresence, summary] = await Promise.all([
      upstream("presence", () => fetchPresence(env, auth)),
      upstream("trophy-summary", () => fetchTrophySummary(env, auth)),
    ]);
    const presence =
      rawPresence.playing && hidden.has(rawPresence.playing.titleId)
        ? { ...rawPresence, playing: null }
        : rawPresence;

    const playing = presence.playing != null;
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

    const failures: string[] = [];

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
    await env.STATE.put(TICK_META_KEY, JSON.stringify(meta));
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
    await env.STATE.put(TICK_META_KEY, JSON.stringify(meta));
    const backoff = await recordTickOutcome(env, error);
    if (error instanceof PsnUpstreamUnavailable) {
      logUpstreamUnavailable(error.call, error, backoff);
    } else {
      console.error(JSON.stringify({ event: "playstation-tick", ...meta }));
    }
    throw error;
  }
}

let localStreak: FailureStreak = { streak: 0, at: 0 };
let localBackoffUntil = 0;

async function currentStreak(env: Env): Promise<FailureStreak> {
  const stored = await readFailureStreak(env.STATE);
  return stored.at >= localStreak.at ? stored : localStreak;
}

async function recordTickOutcome(env: Env, error: unknown): Promise<number> {
  const now = Date.now();
  const previous = await currentStreak(env);
  if (error == null) {
    localStreak = { streak: 0, at: now };
    const stale = Math.max(localBackoffUntil, await readBackoffUntil(env.STATE));
    localBackoffUntil = 0;
    await Promise.all([
      previous.streak !== 0 ? writeFailureStreak(env.STATE, localStreak) : null,
      stale !== 0 ? writeBackoffUntil(env.STATE, 0) : null,
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
    writeFailureStreak(env.STATE, localStreak),
    wait ? writeBackoffUntil(env.STATE, localBackoffUntil) : null,
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

export type TickOutcome = {
  status: "ok" | "skipped";
  detail?: string;
  failing?: string;
};

function ok(detail?: string): TickOutcome {
  return detail ? { status: "ok", detail } : { status: "ok" };
}

let warnedMissing = false;

function skipMissing(): TickOutcome {
  if (!warnedMissing) {
    warnedMissing = true;
    console.warn(JSON.stringify({ event: "playstation-skip", missing: ["PSN_NPSSO"] }));
  }
  return { status: "skipped", detail: "missing PSN_NPSSO" };
}

function failingSince(streak: FailureStreak): Pick<TickOutcome, "failing"> {
  return streak.streak >= 2 ? { failing: `PSN 已连续 ${streak.streak} 轮失败` } : {};
}

export async function runPlaystation(env: Env, power: ConsolePower = "awake"): Promise<TickOutcome> {
  if (!env.PSN_NPSSO?.trim() && !(await readAuth(env.STATE))) return skipMissing();

  const backoffUntil = Math.max(await readBackoffUntil(env.STATE), localBackoffUntil);
  if (Date.now() < backoffUntil) {
    const until = new Date(backoffUntil).toISOString();
    console.log(JSON.stringify({ event: "playstation-backoff", until }));
    return { status: "skipped", detail: `backoff until ${until}`, ...failingSince(await currentStreak(env)) };
  }

  const { run, sinceMs, power: gatePower } = await shouldTick(env, power);
  console.log(
    JSON.stringify({
      event: "playstation-tick-gate",
      run,
      power: gatePower,
      sinceMs: Number.isFinite(sinceMs) ? sinceMs : null,
    }),
  );
  if (!run) return { status: "skipped", detail: "gate closed", ...failingSince(await currentStreak(env)) };

  const { meta } = await tickOnce(env, power);
  return ok(meta.playedGamesChanged || meta.trophiesChanged ? "changed" : undefined);
}

export function resetPlaystationForTests(): void {
  lastFullTickAt = 0;
  localPowerClass = null;
  inflight = null;
  localStreak = { streak: 0, at: 0 };
  localBackoffUntil = 0;
  warnedMissing = false;
}
