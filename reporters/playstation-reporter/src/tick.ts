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
  // 目录必须和指纹同一代：先写 fp:trophies 再写 trophies:last，错代时
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
 * 上一轮完整 tick 的开始时刻，进程内这一份。
 *
 * 和磁盘上那份取较晚的一枚：这一轮刚写下、读还没回来时，下一次探测不会把同一轮再放行。
 * 进程冷起时它是 0，退回磁盘上的记录。
 */
let lastFullTickAt = 0;
/** 上一轮 tick 开始时的调频档。磁盘写入还没回来时用这份。 */
let localPowerClass: ReturnType<typeof powerClass> | null = null;

type Gate = {
  run: boolean;
  sinceMs: number;
  power: ConsolePower;
};

/**
 * 发现循环每次进来问一次。被挡下的那一次完全不碰 PSN、不碰站点。
 * 间隔算的是上一轮**开始**的时刻而不是成功的时刻 —— 否则 PSN 持续故障时，
 * 重试会从闲档一次恶化成每次探测一次。档位规则在 `cadence.ts`。
 */
async function shouldTick(env: Env, power: ConsolePower): Promise<Gate> {
  const lastAt = Math.max(await readFullTickStartedAt(env.STATE), lastFullTickAt);
  const sinceMs = lastAt > 0 ? Date.now() - lastAt : Number.POSITIVE_INFINITY;
  const powerAtLastTick = localPowerClass ?? await readPowerClass(env.STATE);
  return { run: shouldRunTick({ sinceMs, power, powerAtLastTick }), sinceMs, power };
}

let inflight: Promise<TickResult> | null = null;

/**
 * 同一进程里只跑一轮：上一响的 tick 还没跑完（奖杯重爬能跑过一分钟）、这一响
 * 又过了门时，后来的搭前面那一轮的车。
 * 收尾时**只有条目还是自己**才把锁放掉，前一轮的收尾不会把后一轮的锁顺手清了。
 */
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
  // 同步落一份给门，别等下面那个 await —— 它要挡的就是「磁盘还没读到新值」那一次
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
      // 门读的就是这一枚。写在打 PSN 之前，所以它记的是「这轮开始过」而不是
      // 「这轮成功过」—— 上游持续故障时的重试节奏才跟基线一致。
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

/**
 * 连败次数与退避截止时刻，进程里这一份。道理和 `lastFullTickAt` 一样：磁盘写入
 * 还没回来时，下一次探测可能读到旧值。两份各取较新的那一枚。
 */
let localStreak: FailureStreak = { streak: 0, at: 0 };
let localBackoffUntil = 0;

async function currentStreak(env: Env): Promise<FailureStreak> {
  const stored = await readFailureStreak(env.STATE);
  return stored.at >= localStreak.at ? stored : localStreak;
}

/**
 * 一轮收尾时记账：成功清零连败和退避，失败连败加一；上游不可用再按连败次数退避
 * （时长见 state.ts 的 `backoffMs`）。只在值真的变了时才落盘。
 * 返回这次定下的退避时长，没退避是 0。
 */
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
  /** 连着失败两轮以上。容器没有 Sentry cron，日志里留着这句。 */
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

/** 连着失败两轮以上才标出来。单次抖动之后的等待（闲档、退避）不标。 */
function failingSince(streak: FailureStreak): Pick<TickOutcome, "failing"> {
  return streak.streak >= 2 ? { failing: `PSN 已连续 ${streak.streak} 轮失败` } : {};
}

/**
 * 发现循环每次调用。退避和 `shouldTick` 挡下的那一次什么都不做。
 * PSN 的登录每续一次就轮换 refresh token，不给任何入口开「不看门」的口子。
 */
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

/** 测试之间把进程内的门、退避和连败清掉 */
export function resetPlaystationForTests(): void {
  lastFullTickAt = 0;
  localPowerClass = null;
  inflight = null;
  localStreak = { streak: 0, at: 0 };
  localBackoffUntil = 0;
  warnedMissing = false;
}
