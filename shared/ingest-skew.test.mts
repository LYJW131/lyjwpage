import assert from "node:assert/strict";
import test from "node:test";

import { INGEST_FUTURE_SKEW_MS } from "@shared/freshness";
import { preparePlaystationReport } from "@shared/ingest/playstation";
import { prepareServerReport } from "@shared/ingest/server";
import { normalizePlaystationPlayedGames, normalizePlaystationPresence } from "@shared/playstation";
import { psnImageUrl } from "@shared/psn-image";
import { normalizeTrophies } from "@shared/trophies";

const NOW = 1_800_000_000_000;
const PSN_ICON = "https://psnobj.prod.dl.playstation.net/psnobj/a/icon.png";

const presence = (observedAt: number, iconUrl: unknown = PSN_ICON) => ({
  observedAt, online: true, availability: null, platform: "PS5", lastOnlineAt: null,
  playing: { titleId: "PPSA1", title: "Game", format: null, launchPlatform: null, iconUrl },
});
const playedGames = (observedAt: number, imageUrl: unknown = PSN_ICON) => ({
  observedAt,
  items: [{
    titleId: "PPSA1", name: "Game", category: null, playCount: 1, firstPlayedAt: null, lastPlayedAt: null,
    playDurationMs: null, imageUrl, service: null, preOrder: false,
  }],
});
const counts = { platinum: 0, gold: 0, silver: 0, bronze: 0 };
const trophies = (observedAt: number, url: unknown = PSN_ICON) => ({
  observedAt,
  profile: {
    onlineId: "tester", avatarUrl: url, plus: false, level: 1, tier: 1, trophyPoint: 0,
    levelBasePoint: 0, levelNextPoint: 60, levelProgress: 0, earned: counts,
  },
  titles: [{
    npCommunicationId: "NPWR1", name: "Game", localizedName: null, titleIds: ["PPSA1"], iconUrl: url,
    platform: "PS5", progress: 0, defined: counts, earned: counts, lastUpdatedAt: null, playDurationMs: null,
    playCount: 1, firstPlayedAt: null, lastPlayedAt: null, service: null, preOrder: false,
    groups: [{ id: "default", name: "Game", iconUrl: url, progress: 0, defined: counts, earned: counts }],
    trophies: [{
      id: 0, type: "bronze", name: "First", detail: null, iconUrl: url, hidden: false,
      groupId: "default", earned: false, earnedAt: null, earnedRate: null,
    }],
  }],
});

test("PlayStation prepare rejects a section observedAt beyond the receive-time skew", () => {
  const future = NOW + INGEST_FUTURE_SKEW_MS + 1;
  for (const body of [
    { version: 1, presence: presence(future) },
    { version: 1, playedGames: playedGames(future) },
    { version: 1, trophies: trophies(future) },
    { version: 1, presence: presence(NOW), trophies: trophies(future) },
  ]) {
    assert.throws(() => preparePlaystationReport(body, NOW), /observedAt/);
  }
  const edge = NOW + INGEST_FUTURE_SKEW_MS;
  const prepared = preparePlaystationReport({ version: 1, presence: presence(edge), playedGames: playedGames(NOW), trophies: trophies(NOW - 1) }, NOW);
  assert.equal(prepared.presence?.observedAt, edge);
});

test("server prepare rejects an observedAt beyond the receive-time skew", () => {
  const body = (observedAt: number) => ({
    version: 1, id: "s", hostname: "s", publicIp: "203.0.113.10", country: "JP", city: null, isp: "NTT", asn: 2914, asnOrg: "NTT",
    os: "Linux", kernel: "6", cpuCores: 1, cpuUsagePercent: 1, load1: 0, load5: 0, load15: 0,
    memoryTotalBytes: 2, memoryUsedBytes: 1, memoryAvailableBytes: 1, diskTotalBytes: 2, diskUsedBytes: 1,
    networkInterface: "eth0", networkRxBytes: 0, networkTxBytes: 0, networkRxBytesPerSec: 0, networkTxBytesPerSec: 0,
    traffic: null, uptimeSeconds: 1, observedAt,
  });
  assert.equal(prepareServerReport(body(NOW + INGEST_FUTURE_SKEW_MS), NOW).status.observedAt, NOW + INGEST_FUTURE_SKEW_MS);
  assert.throws(() => prepareServerReport(body(NOW + INGEST_FUTURE_SKEW_MS + 1), NOW), /observedAt/);
});

test("PSN image URLs keep only https URLs on the PSN CDN hosts", () => {
  assert.equal(psnImageUrl(PSN_ICON), PSN_ICON);
  assert.equal(psnImageUrl("http://image.api.playstation.com/x.png"), "https://image.api.playstation.com/x.png");
  assert.equal(psnImageUrl("https://psn-rsc.prod.dl.playstation.net/a_xl.png"), "https://psn-rsc.prod.dl.playstation.net/a_xl.png");
  assert.equal(psnImageUrl(null), null);
  for (const bad of [
    "https://attacker.example/beacon.png",
    "https://psnobj.prod.dl.playstation.net.attacker.example/x.png",
    "https://user:pw@psnobj.prod.dl.playstation.net/x.png",
    "https://psnobj.prod.dl.playstation.net:8443/x.png",
    "http://192.168.1.1/x.png",
    "data:image/svg+xml,<svg/>",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(psnImageUrl(bad), null, bad);
  }
});

test("PlayStation normalizers turn non-PSN image URLs into null in every image field", () => {
  const bad = "https://attacker.example/beacon.png";
  assert.equal(normalizePlaystationPresence(presence(NOW, bad)).playing?.iconUrl, null);
  assert.equal(normalizePlaystationPresence(presence(NOW)).playing?.iconUrl, PSN_ICON);
  assert.equal(normalizePlaystationPlayedGames(playedGames(NOW, bad)).items[0]?.imageUrl, null);
  assert.equal(normalizePlaystationPlayedGames(playedGames(NOW)).items[0]?.imageUrl, PSN_ICON);
  const cleaned = normalizeTrophies(trophies(NOW, bad));
  const title = cleaned.titles[0]!;
  assert.deepEqual(
    [cleaned.profile.avatarUrl, title.iconUrl, title.groups[0]!.iconUrl, title.trophies[0]!.iconUrl],
    [null, null, null, null],
  );
  assert.equal(normalizeTrophies(trophies(NOW)).titles[0]!.trophies[0]!.iconUrl, PSN_ICON);
});
