#!/usr/bin/env node
/**
 * 把本地奖杯柜里已经抓好的目录推进站点 ingest，方便开发时立刻看到陈列室。
 * 生产环境由 playstation-reporter 在奖杯指纹变化时推同一份形状。
 *
 *   node scripts/seed-trophies.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CABINET = resolve(ROOT, "../psn-trophy-cabinet/data/trophies.json");
const SITE = process.env.SITE_URL ?? "http://127.0.0.1:3211";

function envLocal() {
  try {
    return readFileSync(resolve(ROOT, ".env.local"), "utf8");
  } catch {
    return "";
  }
}

function secret() {
  const match = /(?:^|\n)TELEMETRY_INGEST_SECRET=(?:"([^"]+)"|([^\n\r]+))/.exec(envLocal());
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

function epochMs(iso) {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function durationMs(raw) {
  const matched =
    /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      raw || "",
    );
  if (!matched) return null;
  const total =
    Number(matched[1] ?? 0) * 604_800 +
    Number(matched[2] ?? 0) * 86_400 +
    Number(matched[3] ?? 0) * 3_600 +
    Number(matched[4] ?? 0) * 60 +
    Number(matched[5] ?? 0);
  return Number.isFinite(total) ? Math.round(total * 1000) : null;
}

function counts(raw) {
  return {
    platinum: Number(raw?.platinum) || 0,
    gold: Number(raw?.gold) || 0,
    silver: Number(raw?.silver) || 0,
    bronze: Number(raw?.bronze) || 0,
  };
}

function norm(value) {
  return (value || "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/playstation.?5 edition|trophies/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function rate(raw) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

const raw = JSON.parse(readFileSync(CABINET, "utf8"));
const playEntries = (raw.played ?? []).map((item) => ({
  keys: [item.name, item.localizedName, item.concept?.name].filter(Boolean).map(norm),
  zh: item.concept?.localizedName?.metadata?.["zh-Hans"] || null,
  ms: durationMs(item.playDuration),
  count: item.playCount || 0,
  first: epochMs(item.firstPlayedDateTime),
  last: epochMs(item.lastPlayedDateTime),
}));

function matchPlay(name) {
  const needle = norm(name);
  const exact = playEntries.filter((item) => item.keys.includes(needle));
  const pool = exact.length
    ? exact
    : playEntries.filter((item) =>
        item.keys.some((key) => key.length >= 8 && (key.includes(needle) || needle.includes(key))),
      );
  if (!pool.length) return null;
  return {
    ms: pool.reduce((sum, item) => sum + (item.ms ?? 0), 0) || null,
    count: pool.reduce((sum, item) => sum + item.count, 0),
    first: pool.map((item) => item.first).filter(Boolean).sort((a, b) => a - b)[0] ?? null,
    last: pool.map((item) => item.last).filter(Boolean).sort((a, b) => a - b).at(-1) ?? null,
    zh: pool.map((item) => item.zh).find(Boolean) || null,
  };
}

const titles = (raw.details ?? []).map((record) => {
  const title = record.title;
  const play = matchPlay(title.trophyTitleName);
  const zh = play?.zh && norm(play.zh) !== norm(title.trophyTitleName) ? play.zh : null;
  return {
    npCommunicationId: title.npCommunicationId,
    name: title.trophyTitleName,
    localizedName: zh,
    titleIds: [],
    iconUrl: title.trophyTitleIconUrl ?? null,
    platform: title.trophyTitlePlatform || "PS",
    progress: Number(title.progress) || 0,
    defined: counts(title.definedTrophies),
    earned: counts(title.earnedTrophies),
    lastUpdatedAt: epochMs(title.lastUpdatedDateTime),
    playDurationMs: play?.ms ?? null,
    playCount: play?.count ?? 0,
    firstPlayedAt: play?.first ?? null,
    lastPlayedAt: play?.last ?? null,
    service: null,
    preOrder: false,
    groups: (record.groups ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      iconUrl: group.icon ?? null,
      progress: Number(group.progress) || 0,
      defined: counts(group.defined),
      earned: counts(group.earned),
    })),
    trophies: (record.trophies ?? []).map((trophy) => ({
      id: Number(trophy.id) || 0,
      type: trophy.type,
      name: trophy.name || (trophy.hidden ? "隐藏奖杯" : "未命名奖杯"),
      detail: trophy.detail || null,
      iconUrl: trophy.icon || null,
      hidden: Boolean(trophy.hidden),
      groupId: trophy.group || "default",
      earned: Boolean(trophy.earned),
      earnedAt: epochMs(trophy.earnedAt),
      earnedRate: rate(trophy.rate),
    })),
  };
});

const envelope = {
  version: 1,
  trophies: {
    observedAt: Date.now(),
    profile: {
      onlineId: raw.profile.onlineId,
      avatarUrl: null,
      plus: Boolean(raw.profile.isPlus),
      level: raw.summary.trophyLevel,
      tier: raw.summary.tier,
      trophyPoint: raw.summary.trophyPoint,
      levelBasePoint: raw.summary.trophyLevelBasePoint,
      levelNextPoint: raw.summary.trophyLevelNextPoint,
      levelProgress: raw.summary.progress,
      earned: counts(raw.summary.earnedTrophies),
    },
    titles,
  },
};

const token = secret();
const response = await fetch(`${SITE.replace(/\/+$/, "")}/api/ingest/playstation`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(envelope),
});
const body = await response.text();
if (!response.ok) {
  throw new Error(`ingest ${response.status}: ${body.slice(0, 400)}`);
}
const parsed = JSON.parse(body);
console.log(
  `seeded ${titles.length} titles / ${titles.reduce((sum, title) => sum + title.trophies.length, 0)} trophies`,
  parsed,
);
