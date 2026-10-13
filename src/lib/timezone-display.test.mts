import assert from "node:assert/strict";
import test from "node:test";

delete process.env.BUILD_TIME;
const {
  formatTimezoneRegion,
  formatUTCOffset,
  resolveTimezoneDisplay,
  timezoneAbbreviation,
  timezoneOffsetSeconds,
  validTimezone,
} = await import("./timezone-display.ts");

const WINTER = Date.parse("2026-01-15T12:00:00Z");
const SUMMER = Date.parse("2026-07-15T12:00:00Z");

test("validTimezone：IANA 名通过，乱写的与空串不通过", () => {
  assert.equal(validTimezone("Asia/Shanghai"), true);
  assert.equal(validTimezone("UTC"), true);
  assert.equal(validTimezone("Mars/Olympus"), false);
  assert.equal(validTimezone(""), false);
});

test("formatTimezoneRegion：首段斜杠后穿到城市名，下划线转空格", () => {
  assert.equal(formatTimezoneRegion("Asia/Shanghai"), "Asia/Shanghai");
  assert.equal(formatTimezoneRegion("America/Argentina/Buenos_Aires"), "America/Argentina/Buenos Aires");
  assert.equal(formatTimezoneRegion("UTC"), "UTC");
});

test("formatUTCOffset：负号用 U+2212，半小时偏移也标出分钟", () => {
  assert.equal(formatUTCOffset(28_800), "UTC+08:00");
  assert.equal(formatUTCOffset(0), "UTC+00:00");
  assert.equal(formatUTCOffset(-18_000), "UTC−05:00");
  assert.equal(formatUTCOffset(20_700), "UTC+05:45");
  assert.equal(formatUTCOffset(-16_200), "UTC−04:30");
});

test("timezoneOffsetSeconds：固定偏移、夏令时两侧、半点偏移都按当刻算", () => {
  assert.equal(timezoneOffsetSeconds(WINTER, "Asia/Shanghai"), 28_800);
  assert.equal(timezoneOffsetSeconds(WINTER, "America/New_York"), -18_000);
  assert.equal(timezoneOffsetSeconds(SUMMER, "America/New_York"), -14_400);
  assert.equal(timezoneOffsetSeconds(WINTER, "Europe/London"), 0);
  assert.equal(timezoneOffsetSeconds(SUMMER, "Europe/London"), 3_600);
  assert.equal(timezoneOffsetSeconds(WINTER, "Asia/Kathmandu"), 20_700);
  assert.equal(timezoneOffsetSeconds(WINTER, "Australia/Lord_Howe"), 39_600);
  assert.equal(timezoneOffsetSeconds(SUMMER, "Australia/Lord_Howe"), 37_800);
});

test("timezoneAbbreviation：固定表先走，其余按英语区逐个试，只给 GMT±N 的返回 null", () => {
  assert.equal(timezoneAbbreviation(WINTER, "Asia/Shanghai"), "CST");
  assert.equal(timezoneAbbreviation(WINTER, "Asia/Tokyo"), "JST");
  assert.equal(timezoneAbbreviation(WINTER, "America/New_York"), "EST");
  assert.equal(timezoneAbbreviation(SUMMER, "America/New_York"), "EDT");
  assert.equal(timezoneAbbreviation(WINTER, "America/Los_Angeles"), "PST");
  assert.equal(timezoneAbbreviation(WINTER, "Europe/London"), "GMT");
  assert.equal(timezoneAbbreviation(WINTER, "Etc/GMT+8"), null);
});

const reported = (partial: Record<string, unknown>) => ({
  identifier: "Asia/Shanghai",
  abbreviation: null,
  secondsFromGMT: 28_800,
  observedAt: WINTER,
  ...partial,
});

test("resolveTimezoneDisplay：Mac 上报合法就用 Mac 的，否则回落到站点时区", () => {
  const mac = resolveTimezoneDisplay(
    reported({ identifier: "America/New_York", abbreviation: "EST", secondsFromGMT: -18_000 }),
    WINTER,
  );
  assert.deepEqual(mac, { identifier: "America/New_York", abbreviation: "EST", offsetSeconds: -18_000, usingMac: true });

  const fallback = resolveTimezoneDisplay(reported({ identifier: "Mars/Olympus" }), WINTER);
  assert.equal(fallback.usingMac, false);
  assert.equal(fallback.identifier, "Asia/Shanghai");
  assert.equal(fallback.abbreviation, "CST");
  assert.equal(fallback.offsetSeconds, 28_800);

  const absent = resolveTimezoneDisplay(null, WINTER);
  assert.deepEqual(absent, { identifier: "Asia/Shanghai", abbreviation: "CST", offsetSeconds: 28_800, usingMac: false });
});

test("resolveTimezoneDisplay：算不出缩写时拿上报的缩写兜底，但 GMT±N 样式的不要", () => {
  const fallback = resolveTimezoneDisplay(
    reported({ identifier: "Etc/GMT+8", abbreviation: "GMT-08:00" }),
    WINTER,
  );
  assert.equal(fallback.abbreviation, null);
  assert.equal(fallback.offsetSeconds, -28_800);

  const claimed = resolveTimezoneDisplay(
    reported({ identifier: "Etc/GMT+8", abbreviation: "CST" }),
    WINTER,
  );
  assert.equal(claimed.abbreviation, "CST");
});

test("resolveTimezoneDisplay：now=0 时回到上报时刻；两边都没有时间就没有偏移", () => {
  const reportedOnly = resolveTimezoneDisplay(reported({ identifier: "Asia/Tokyo", observedAt: WINTER }), 0);
  assert.equal(reportedOnly.abbreviation, "JST");
  assert.equal(reportedOnly.offsetSeconds, 32_400);

  const nothing = resolveTimezoneDisplay(null, 0);
  assert.equal(nothing.identifier, "Asia/Shanghai");
  assert.equal(nothing.abbreviation, null);
  assert.equal(nothing.offsetSeconds, null);
});
