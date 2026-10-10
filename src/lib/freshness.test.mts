import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_LIMITS_STALE_MS,
  chargingFeedClockStale,
  RESUME_REFETCH_GRACE_MS,
  clockAdvance,
  clockReading,
  confirmStale,
  hasPendingDeadline,
  resumeStep,
  resumeTimedOut,
  activityCurrentAt,
  activityDateEndsAt,
  activityDisplayedCurrent,
  isStale,
  liveChargingFeed,
  liveNowListening,
  localDate,
  PLAYSTATION_STALE_MS,
  type ChargingFeed,
} from "./freshness.ts";
import type { LocalNowPlaying, NowListeningPayload } from "./types.ts";

test("PlayStation 陈旧窗口覆盖三轮闲档（30 分钟），并在缓存余量耗尽后变陈旧", () => {
  const windowMs = PLAYSTATION_STALE_MS;
  assert.equal(windowMs, 95 * 60_000);
  const at = 1_000;
  assert.equal(isStale({ now: at + 3 * 30 * 60_000, at, windowMs }), false);
  assert.equal(isStale({ now: at + windowMs, at, windowMs }), false);
  assert.equal(isStale({ now: at + windowMs + 1, at, windowMs }), true);
});

test("限额陈旧窗口覆盖三轮闲档（60 分钟）", () => {
  const windowMs = AGENT_LIMITS_STALE_MS;
  assert.equal(windowMs, 185 * 60_000);
  const at = 1_000;
  assert.equal(isStale({ now: at + 3 * 60 * 60_000, at, windowMs }), false);
  assert.equal(isStale({ now: at + windowMs, at, windowMs }), false);
  assert.equal(isStale({ now: at + windowMs + 1, at, windowMs }), true);
});

const T = 1_700_000_000_000;

function feed(partial: Partial<ChargingFeed> = {}): ChargingFeed {
  return {
    connected: true,
    pushedAt: T,
    staleAfterMs: 300_000,
    lastSeenAt: T,
    declaredOffline: false,
    heartbeatWindowMs: 300_000,
    ...partial,
  };
}

test("充电头 / 充电宝按钟判：Mac 心跳窗口或这一路自己的窗口，过了任一个就算断", () => {
  assert.equal(chargingFeedClockStale(feed(), T + 300_000), false);
  assert.equal(chargingFeedClockStale(feed({ lastSeenAt: T - 1 }), T + 300_000), true);
  assert.equal(chargingFeedClockStale(feed({ pushedAt: T - 1 }), T + 300_000), true);
  assert.equal(chargingFeedClockStale(feed({ pushedAt: 0 }), T), true);
  assert.equal(chargingFeedClockStale(feed({ declaredOffline: true }), T), false);
});

test("首帧没有访客钟：按钟一律不判，免得和服务端 HTML 各画各的", () => {
  assert.equal(chargingFeedClockStale(feed({ lastSeenAt: 1, pushedAt: 1 }), 0), false);
});

test("liveChargingFeed 把亲口离线和按钟断流盖成 connected: false，其余原样", () => {
  const live = feed();
  assert.equal(liveChargingFeed(live, false), live);
  assert.equal(liveChargingFeed(live, true).connected, false);
  assert.equal(liveChargingFeed(feed({ declaredOffline: true }), false).connected, false);
  assert.equal(liveChargingFeed(feed({ connected: false }), false).connected, false);
  const patched = liveChargingFeed({ ...live, totalPower: 42 }, true);
  assert.equal(patched.totalPower, 42);
});

function song(source: LocalNowPlaying["source"], title: string): LocalNowPlaying {
  return {
    source,
    state: "playing",
    title,
    artist: null,
    album: null,
    trackId: null,
    artworkUrl: null,
    positionMs: 0,
    durationMs: 180_000,
    repeatOne: false,
    observedAt: T,
  };
}

function nowListening(partial: Partial<NowListeningPayload> = {}): NowListeningPayload {
  return {
    music: song("apple-music", "Mac"),
    receivedAt: T,
    idle: false,
    id: "mac-album",
    link: "https://music.apple.com/mac",
    songId: "mac-song",
    upcomingSongIds: ["mac-next"],
    hasLyrics: true,
    motion: { videoUrl: "https://mvod.itunes.apple.com/mac.m3u8", colors: null },
    expiresInMs: null,
    alternate: null,
    lastSeenAt: T,
    declaredOffline: false,
    heartbeatWindowMs: 300_000,
    ...partial,
  };
}

test("正在听：Mac 在线时原样", () => {
  const payload = nowListening();
  assert.equal(liveNowListening(payload, false), payload);
});

test("正在听：Mac 掉线且没有接班的，就当没在放", () => {
  const next = liveNowListening(nowListening({ expiresInMs: 4_000 }), true);
  assert.equal(next.idle, true);
  assert.equal(next.music, null);
  assert.equal(next.songId, null);
  assert.deepEqual(next.upcomingSongIds, []);
  assert.equal(next.hasLyrics, false);
  assert.equal(next.expiresInMs, null);
});

test("正在听：Mac 掉线时换成 HomePod 还在放的那首", () => {
  const pod = song("homepod", "HomePod");
  const next = liveNowListening(
    nowListening({
      alternate: {
        music: pod,
        id: "pod-album",
        link: "https://music.apple.com/pod",
        songId: "pod-song",
        upcomingSongIds: [],
        hasLyrics: false,
        motion: null,
      },
    }),
    true,
  );
  assert.equal(next.idle, false);
  assert.equal(next.music, pod);
  assert.equal(next.id, "pod-album");
  assert.equal(next.songId, "pod-song");
  assert.equal(next.hasLyrics, false);
  assert.equal(next.motion, null, "Mac 那首的动态封面不能留在换上来的 HomePod 曲目上");
  assert.equal(next.alternate, null);
});

test("正在听：选中的是 HomePod 时不看 Mac 的存活", () => {
  const payload = nowListening({ music: song("homepod", "HomePod") });
  assert.equal(liveNowListening(payload, true), payload);
});

test("访客钟：deadline 已过真实时间、但晚于手上那把钟时也要推（不然永远判不出过期）", () => {
  const clock = 1_000;
  const realNow = 50_000;
  assert.deepEqual(clockAdvance(clock, [20_000], realNow), { kind: "now", to: 20_000 });
  assert.deepEqual(clockAdvance(clock, [60_000], realNow), { kind: "later", delayMs: 10_250, to: 60_000 });
  assert.deepEqual(clockAdvance(clock, [60_000, 20_000], realNow), { kind: "now", to: 20_000 });
  assert.deepEqual(clockAdvance(20_000 + 1, [60_000, 20_000], realNow), { kind: "later", delayMs: 10_250, to: 60_000 });
  assert.deepEqual(clockAdvance(clock, [null, 60_000], realNow), { kind: "later", delayMs: 10_250, to: 60_000 });
});

test("访客钟：不早于钟的 deadline 不再处理，推完一次就不会原地循环", () => {
  assert.deepEqual(clockAdvance(20_000, [20_000], 50_000), { kind: "idle" });
  assert.deepEqual(clockAdvance(20_000, [5_000, null], 50_000), { kind: "idle" });
  assert.deepEqual(clockAdvance(20_000, [], 50_000), { kind: "idle" });
  assert.deepEqual(clockAdvance(50_000, [20_000], 50_000), { kind: "idle" });
});

test("钟作不作准：有晚于钟的 deadline 就得先核对", () => {
  assert.equal(hasPendingDeadline(1_000, [20_000]), true);
  assert.equal(hasPendingDeadline(20_000, [20_000, null]), false);
  assert.equal(hasPendingDeadline(1_000, [null, null]), false);
});

test("按钟判的过期：钟还没追上新数据的 deadline 时，不因「不过期」松开按住的离线", () => {
  assert.deepEqual(
    confirmStale(true, { stale: false, active: true, validating: false, settled: false }),
    { held: true, stale: true },
  );
  assert.deepEqual(
    confirmStale(true, { stale: true, active: true, validating: false, settled: true }),
    { held: true, stale: true },
  );
  assert.deepEqual(
    confirmStale(true, { stale: false, active: true, validating: false, settled: true }),
    { held: false, stale: false },
  );
  assert.deepEqual(
    confirmStale(false, { stale: false, active: true, validating: false, settled: false }),
    { held: false, stale: false },
  );
});

test("切回前台：回源开始又结束之前都算回源途中", () => {
  let state = { active: true, resuming: false, sawValidating: false };
  state = resumeStep(state, { active: false, validating: false });
  assert.deepEqual(state, { active: false, resuming: false, sawValidating: false });
  state = resumeStep(state, { active: true, validating: false });
  assert.equal(state.resuming, true);
  assert.equal(
    confirmStale(false, { stale: true, active: true, validating: state.resuming }).stale,
    false,
  );
  state = resumeStep(state, { active: true, validating: true });
  assert.deepEqual(state, { active: true, resuming: true, sawValidating: true });
  state = resumeStep(state, { active: true, validating: false });
  assert.deepEqual(state, { active: true, resuming: false, sawValidating: false });
});

test("切回前台：没变化时返回同一个对象（渲染期对齐不会死循环）", () => {
  const idle = { active: true, resuming: false, sawValidating: false };
  assert.equal(resumeStep(idle, { active: true, validating: true }), idle);
  assert.equal(resumeStep(idle, { active: true, validating: false }), idle);
  const hidden = { active: false, resuming: false, sawValidating: false };
  assert.equal(resumeStep(hidden, { active: false, validating: true }), hidden);
  const waiting = { active: true, resuming: true, sawValidating: false };
  assert.equal(resumeStep(waiting, { active: true, validating: false }), waiting);
});

test("切回前台：等不来回源（SWR 节流）就在宽限之后不再等", () => {
  assert.ok(RESUME_REFETCH_GRACE_MS > 0 && RESUME_REFETCH_GRACE_MS <= 2_000);
  const waiting = { active: true, resuming: true, sawValidating: false };
  assert.deepEqual(resumeTimedOut(waiting), { active: true, resuming: false, sawValidating: false });
  const inFlight = { active: true, resuming: true, sawValidating: true };
  assert.equal(resumeTimedOut(inFlight), inFlight);
});

test("按钟判的过期：回源途中或后台不做新的确认", () => {
  assert.deepEqual(confirmStale(false, { stale: true, active: true, validating: true }), { held: false, stale: false });
  assert.deepEqual(confirmStale(false, { stale: true, active: false, validating: false }), { held: false, stale: false });
  assert.deepEqual(confirmStale(false, { stale: true, active: true, validating: false }), { held: true, stale: true });
});

test("按钟判的过期：确认下来之后，回源途中和退到后台都按住", () => {
  assert.deepEqual(confirmStale(true, { stale: true, active: true, validating: true }), { held: true, stale: true });
  assert.deepEqual(confirmStale(true, { stale: true, active: false, validating: false }), { held: true, stale: true });
  assert.deepEqual(confirmStale(true, { stale: true, active: false, validating: true }), { held: true, stale: true });
});

test("按钟判的过期：只有数据重新新鲜才松开", () => {
  assert.deepEqual(confirmStale(true, { stale: false, active: true, validating: false }), { held: false, stale: false });
  assert.deepEqual(confirmStale(true, { stale: false, active: false, validating: true }), { held: false, stale: false });
});

test("首帧拿首屏信封的 servedAt 当钟：填缓存那一刻已经断了的，首帧就不当活的", () => {
  const servedAt = T + 600_000;
  const stale = feed({ connected: true });
  assert.equal(chargingFeedClockStale(stale, servedAt), true);
  assert.equal(liveChargingFeed(stale, chargingFeedClockStale(stale, servedAt)).connected, false);
  assert.equal(chargingFeedClockStale(stale, T + 1_000), false);
});

test("访客钟读数：首帧用首屏信封的 servedAt，挂载后换挂载时刻，推过钟后用推钟时刻", () => {
  assert.equal(clockReading(0, 0, 5_000), 5_000);
  assert.equal(clockReading(0, 9_000, 5_000), 9_000);
  assert.equal(clockReading(12_000, 9_000, 5_000), 12_000);
  assert.equal(clockReading(0, 4_000, 5_000), 5_000);
  assert.equal(clockReading(4_500, 4_000, 5_000), 5_000);
  assert.equal(clockReading(6_000, 4_000, 5_000), 6_000);
  assert.equal(clockReading(0, 0, undefined), 0);
  assert.equal(isStale({ now: clockReading(0, 0, undefined), at: 1, windowMs: 1 }), false);
});

test("可滞后层首帧：首屏缓存填的那一刻已经过了阈值的，首帧就判过期", () => {
  const fetchedAt = 1_000_000;
  const windowMs = 10 * 60_000;
  const servedAt = fetchedAt + 20 * 60_000;
  assert.equal(isStale({ now: clockReading(0, 0, servedAt), at: fetchedAt, windowMs }), true);
  assert.equal(isStale({ now: clockReading(0, 0, fetchedAt + 60_000), at: fetchedAt, windowMs }), false);
});

test("推钟推到此刻与 deadline 里较晚的那个：系统时钟往回调过也跨得过去", () => {
  const advance = clockAdvance(50_000, [60_000], 55_000);
  assert.equal(advance.kind, "later");
  const ticked = Math.max(40_000, advance.kind === "later" ? advance.to : 0);
  assert.equal(ticked, 60_000);
  assert.deepEqual(clockAdvance(ticked, [60_000], 40_000), { kind: "idle" }, "跨过去之后不再挂着");
});

test("活动圆环：冻住的 currentAtSource 跨过源站当地日就不再是今天", () => {
  const secondsFromGMT = 8 * 3600;
  const date = "2026-10-10";
  const ends = activityDateEndsAt(date, secondsFromGMT);
  assert.equal(ends, Date.parse(`${date}T00:00:00.000Z`) + 24 * 60 * 60 * 1000 - secondsFromGMT * 1000);
  const payload = { date, secondsFromGMT, currentAtSource: true };
  assert.equal(activityCurrentAt(date, secondsFromGMT, ends! - 1), true);
  assert.equal(activityDisplayedCurrent(payload, ends! - 1), true);
  assert.equal(activityCurrentAt(date, secondsFromGMT, ends!), false);
  assert.equal(activityDisplayedCurrent(payload, ends!), false);
  assert.equal(activityDisplayedCurrent(payload, 0), true);
});

test("活动圆环：钟还停在上一日时，更新的 date 仍信取数结果", () => {
  const secondsFromGMT = 8 * 3600;
  const ends = activityDateEndsAt("2026-10-10", secondsFromGMT);
  assert.ok(ends);
  const duringPreviousDay = ends - 60_000;
  assert.equal(
    activityDisplayedCurrent({ date: "2026-10-11", secondsFromGMT, currentAtSource: true }, duringPreviousDay),
    true,
  );
  assert.equal(
    activityDisplayedCurrent({ date: "2026-10-11", secondsFromGMT, currentAtSource: false }, duringPreviousDay),
    false,
  );
});

test("活动圆环：西半球用同一套固定偏移，日界不是访客时区", () => {
  const secondsFromGMT = -7 * 3600;
  const date = "2026-10-10";
  const ends = activityDateEndsAt(date, secondsFromGMT);
  assert.ok(ends);
  assert.equal(activityCurrentAt(date, secondsFromGMT, ends - 1), true);
  assert.equal(localDate(ends - 1, secondsFromGMT), date);
  assert.equal(activityCurrentAt(date, secondsFromGMT, ends), false);
  assert.equal(localDate(ends, secondsFromGMT), "2026-10-11");
});

test("活动圆环：不是 YYYY-MM-DD 的 date 在有钟之后不算今天", () => {
  assert.equal(activityDateEndsAt("2026-9-1", 0), null);
  assert.equal(activityDisplayedCurrent({ date: "yesterday", secondsFromGMT: 0, currentAtSource: true }, 1_000), false);
  assert.equal(activityDisplayedCurrent({ date: "yesterday", secondsFromGMT: 0, currentAtSource: true }, 0), true);
});

test("刚好推到窗口那一刻也判得出过期：deadline 取窗口之后那一毫秒", () => {
  const at = 1_000, windowMs = 60_000;
  const deadline = at + windowMs + 1;
  assert.equal(isStale({ now: deadline, at, windowMs }), true);
  assert.equal(isStale({ now: deadline - 1, at, windowMs }), false);
});
