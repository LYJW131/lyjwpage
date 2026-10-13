import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { SERVER_TAG } from "@shared/live-events";
import { MemoryKv } from "@shared/testing/memory-kv";
import { ACTIVE_COLLECTOR_JOBS, type CollectorJobOutcome, type CollectorRpc } from "@shared/collector";
import { CREDENTIAL_KEYS } from "@shared/credentials";
import type { HistoryDb, HistoryStatement } from "@shared/history-ingest";
import { prepareIngest, type CoreCommand } from "@shared/ingest/prepare";
import { resetStoredImageCacheForTests } from "@shared/ingest/r2-assets";
import { LAG_KEYS, readLag } from "@shared/lag";
import type { CommitReply, StateCoreRpc } from "@shared/state-core";
import { STORAGE_MAX_BYTES } from "@shared/storage-contract";
import type { EnrichmentFollowUp, EnrichmentOutcome } from "@shared/track-enrichment";

import { DEV_ACCESS_ISSUER } from "./access-auth";
import type { Env } from "./env";
import { DEPLOYMENT_JOBS, handleRequest } from "./worker";


const AUD = "local-dev";
const ALL = "all.access";
const MAC_ONLY = "mac-only.access";
const DEPLOYER = "github-actions.access";
const SOURCES = ["mac", "iphone", "homepod", "emby", "playstation", "server", "agents"];

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
) as CryptoKeyPair;
const { kty, n, e } = await crypto.subtle.exportKey("jwk", pair.publicKey) as JsonWebKey;
const JWKS = JSON.stringify({ keys: [{ kty, n, e, kid: "local-dev" }] });

const b64url = (data: Uint8Array | string) => Buffer.from(typeof data === "string" ? new TextEncoder().encode(data) : data).toString("base64url");

async function jwt(clientId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64url(JSON.stringify({ alg: "RS256", kid: "local-dev" }))}.${b64url(JSON.stringify({
    aud: [AUD], iss: DEV_ACCESS_ISSUER, iat: now, exp: now + 600, common_name: clientId, type: "app",
  }))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(head));
  return `${head}.${b64url(new Uint8Array(signature))}`;
}

type Calls = {
  ready: number;
  commits: CoreCommand[];
  revalidated: string[][];
  broadcasts: number;
  refreshed: string[][];
  heads: string[];
  archived: string[][];
  enriched: Parameters<CollectorRpc["enrichTrack"]>[];
  followUps: EnrichmentFollowUp[];
};

type Setup = {
  reply?: (command: CoreCommand) => CommitReply | Promise<CommitReply>;
  refresh?: CollectorRpc["refresh"];
  enrichTrack?: CollectorRpc["enrichTrack"];
  collector?: boolean;
};

function world(setup: Setup = {}) {
  const calls: Calls = { ready: 0, commits: [], revalidated: [], broadcasts: 0, refreshed: [], heads: [], archived: [], enriched: [], followUps: [] };
  const lag = new MemoryKv();
  const credentials = new MemoryKv();
  const core: StateCoreRpc = {
    ready: async () => { calls.ready += 1; return true; },
    commitIngest: async (command) => {
      assert.deepEqual(structuredClone(command), command);
      calls.commits.push(command);
      return setup.reply ? setup.reply(command) : { ready: true, ok: true, data: { accepted: 1 } };
    },
    broadcastVersion: async () => { calls.broadcasts += 1; return 3; },
    revalidate: async (tags) => { calls.revalidated.push(tags); },
    audience: async () => ({ connections: 0, online: 0 }),
    playstationPower: async () => null,
    appleDeveloperToken: async () => { throw new Error("not used"); },
    commitRecentlyPlayed: async () => { throw new Error("not used"); },
    commitRecentTracks: async () => { throw new Error("not used"); },
    commitEnrichmentPatch: async () => { throw new Error("not used"); },
  };
  const collector: CollectorRpc = {
    refresh: setup.refresh ?? (async (jobs) => {
      calls.refreshed.push(jobs);
      return jobs.map((job): CollectorJobOutcome => ({ job, status: "ok", ms: 1 }));
    }),
    enrichTrack: async (music, upcomingTracks) => {
      calls.enriched.push([music, upcomingTracks]);
      return setup.enrichTrack ? setup.enrichTrack(music, upcomingTracks) : null;
    },
    followUpTrack: async (followUp) => {
      assert.deepEqual(structuredClone(followUp), followUp);
      calls.followUps.push(followUp);
    },
  };
  const history: HistoryDb = {
    prepare: (sql) => ({ sql, bind() { return this; } }) as unknown as HistoryStatement,
    batch: async (statements) => { calls.archived.push(statements.map((statement) => (statement as unknown as { sql: string }).sql)); return []; },
  };
  const env = {
    CORE: core,
    ...(setup.collector === false ? {} : { COLLECTOR: collector }),
    IMAGES: { head: async (key: string) => { calls.heads.push(key); return {}; } } as unknown as R2Bucket,
    LAG: lag as unknown as KVNamespace,
    CREDENTIALS: credentials as unknown as KVNamespace,
    HISTORY: history as unknown as D1Database,
    ACCESS_TEAM_DOMAIN: DEV_ACCESS_ISSUER,
    ACCESS_AUD: AUD,
    ACCESS_DEV_JWKS: JWKS,
    ACCESS_CLIENTS: {
      [ALL]: [...SOURCES.map((source) => `ingest:${source}`), "ingest:agents-otlp"],
      [MAC_ONLY]: ["ingest:mac"],
      [DEPLOYER]: ["internal:site-deployed", "internal:collector-refresh"],
    },
  } satisfies Env;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); }, passThroughOnException() {} } as unknown as ExecutionContext;
  return {
    calls, lag, credentials, env,
    async send(path: string, init: { method?: string; body?: BodyInit | null; client?: string | null; headers?: Record<string, string> } = {}) {
      const headers = new Headers(init.headers);
      const client = init.client === undefined ? ALL : init.client;
      if (client) headers.set("Cf-Access-Jwt-Assertion", await jwt(client));
      const response = await handleRequest(new Request(`https://ingest.homepage.lyjw.llc${path}`, {
        method: init.method ?? "POST", headers, body: init.body,
      }), env, ctx);
      await Promise.allSettled(pending.splice(0));
      return response;
    },
  };
}

async function json(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

function mac(modules: Record<string, unknown>, activeModules: string[] = Object.keys(modules)) {
  return { version: 4, presence: "online", heartbeatAt: Date.now(), activeModules, modules };
}

function server() {
  return {
    version: 1, id: "misaka-jp", hostname: "misaka-jp", publicIp: "203.0.113.7",
    country: null, city: null, isp: null, asn: null, asnOrg: null, os: "Debian", kernel: "6.1",
    cpuCores: 2, cpuUsagePercent: 12.3, load1: 0.1, load5: 0.1, load15: 0.1,
    memoryTotalBytes: 2 * 1024 ** 3, memoryUsedBytes: 1024 ** 3, memoryAvailableBytes: 1024 ** 3,
    diskTotalBytes: 20 * 1024 ** 3, diskUsedBytes: 5 * 1024 ** 3,
    networkInterface: "eth0", networkRxBytes: 1, networkTxBytes: 1, networkRxBytesPerSec: 1, networkTxBytesPerSec: 1,
    traffic: null, uptimeSeconds: 100, observedAt: Date.now(),
  };
}

function workout(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111", activityType: "Running",
    startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 1_800_000, durationSeconds: 1_500, secondsFromGMT: 0,
    ...overrides,
  };
}

const post = (body: unknown) => ({ body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("routes: only the ingest paths and site-deployed exist; unknown sources are 404 before auth", async () => {
  const w = world();
  const root = await w.send("/", { method: "GET", client: null });
  assert.equal(root.status, 200);
  assert.deepEqual(await json(root), { ok: true, service: "ingest" });
  for (const path of ["/count", "/ws", "/api/status/listening/now", "/api/internal/storage/import"]) {
    assert.equal((await w.send(path, { method: "GET", client: null })).status, 404, path);
  }
  const get = await w.send("/api/ingest/mac", { method: "GET", client: null });
  assert.equal(get.status, 405);
  assert.deepEqual(await json(get), { ok: false, error: "只接受 POST" });
  const unknown = await w.send("/api/ingest/constructor", post({}));
  assert.equal(unknown.status, 404);
  assert.deepEqual(await json(unknown), { ok: false, error: "没有这个上报来源：constructor" });
  assert.equal((await w.send("/api/ingest/agents-otlp", post({}))).status, 404, "the OTLP source is only reachable on its own path");
  assert.equal(w.calls.commits.length, 0);
});

test("preview versions refuse every report and hide site-deployed", async () => {
  const previous = process.env.PREVIEW_WORKER;
  process.env.PREVIEW_WORKER = "true";
  try {
    const w = world();
    const refused = await w.send("/api/ingest/mac", post(mac({})));
    assert.equal(refused.status, 403);
    assert.deepEqual(await json(refused), { ok: false, error: "预览 Worker 不接收上报" });
    assert.equal((await w.send("/api/ingest/agents/otlp", post({ resourceMetrics: [] }))).status, 403);
    assert.equal((await w.send("/api/internal/site-deployed", { client: DEPLOYER })).status, 404);
    assert.equal((await w.send("/api/internal/collector-refresh", { client: DEPLOYER })).status, 404);
    assert.equal(w.calls.commits.length + w.calls.broadcasts + w.calls.refreshed.length, 0);
  } finally {
    if (previous === undefined) delete process.env.PREVIEW_WORKER; else process.env.PREVIEW_WORKER = previous;
  }
});

test("auth: only a signed Access assertion counts, and each client id writes only its own sources", async () => {
  const w = world();
  const missing = await w.send("/api/ingest/mac", { ...post(mac({})), client: null });
  assert.equal(missing.status, 401);
  assert.deepEqual(await json(missing), { ok: false, error: "未授权" });
  assert.equal((await w.send("/api/ingest/mac", { ...post(mac({})), client: null, headers: { authorization: "Bearer retired-secret" } })).status, 401);
  assert.equal((await w.send("/api/ingest/mac", { ...post(mac({})), client: null, headers: { "CF-Access-Client-Id": MAC_ONLY, "CF-Access-Client-Secret": "x" } })).status, 401);
  const wrongSource = await w.send("/api/ingest/emby", { ...post({}), client: MAC_ONLY });
  assert.equal(wrongSource.status, 403);
  assert.deepEqual(await json(wrongSource), { ok: false, error: "这把凭据不能做这件事" });
  assert.equal((await w.send("/api/ingest/agents/otlp", { ...post({ resourceMetrics: [] }), client: MAC_ONLY })).status, 403);
  assert.equal((await w.send("/api/internal/site-deployed", { client: MAC_ONLY })).status, 403);
  assert.equal((await w.send("/api/ingest/emby", { ...post({}), client: DEPLOYER })).status, 403, "the deploy token cannot write reports");
  assert.equal((await w.send("/api/ingest/mac", { ...post(mac({})), client: "unregistered.access" })).status, 403);
  assert.equal(w.calls.commits.length, 0);
  assert.equal((await w.send("/api/ingest/mac", { ...post(mac({})), client: MAC_ONLY })).status, 202);
});

test("receipts: 202 carries the state core's data; invalid input is a 400 without asking for readiness", async () => {
  const w = world({ reply: () => ({ ready: true, ok: true, data: { accepted: 0, heartbeat: true } }) });
  const accepted = await w.send("/api/ingest/mac", post(mac({})));
  assert.equal(accepted.status, 202);
  assert.deepEqual(await json(accepted), { ok: true, data: { accepted: 0, heartbeat: true, ignored: [], rejected: [] } });
  assert.equal(accepted.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(accepted.headers.get("cache-control"), "no-store");

  const invalidJson = await w.send("/api/ingest/mac", { body: '{"private-marker":' });
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await json(invalidJson), { ok: false, error: "上报数据无效或处理失败" });
  const invalid = await w.send("/api/ingest/mac", post({}));
  assert.equal(invalid.status, 400);
  assert.equal(w.calls.ready, 0, "ingress never asks the state core for readiness");

  const notReady = world({ reply: () => ({ ready: false, ok: false }) });
  const late = await notReady.send("/api/ingest/iphone", post({ version: 1 }));
  assert.equal(late.status, 503);
  assert.deepEqual(await json(late), { ok: false, error: "状态存储暂时不可用，请重试" });

  const rejected = world({ reply: () => ({ ready: true, ok: false, error: "desktop 模块缺少 applicationName" }) });
  const rejection = await rejected.send("/api/ingest/mac", post(mac({ timezone: { identifier: "Asia/Tokyo", secondsFromGMT: 32400 } })));
  assert.equal(rejection.status, 400);
  assert.deepEqual(await json(rejection), { ok: false, error: "上报数据无效或处理失败" });
  assert.equal(rejected.lag.writes, 0, "a report the state core rejected leaves the lag layer alone");

  const broken = world({ reply: () => { throw new Error("RPC reset"); } });
  assert.equal((await broken.send("/api/ingest/homepod", post({ state: "playing", title: "x" }))).status, 400);

  const transient = world({ reply: () => ({ ready: true, ok: false, error: "Durable Object reset because its code was updated.", retryable: true }) });
  const retryLater = await transient.send("/api/ingest/homepod", post({ state: "playing", title: "x" }));
  assert.equal(retryLater.status, 503, "a transient state core failure must not look like a bad report");
  assert.deepEqual(await json(retryLater), { ok: false, error: "状态存储暂时不可用，请重试" });
  assert.equal(transient.lag.writes, 0);
  assert.equal(transient.calls.archived.length, 0);

  const severed = world({ reply: () => { throw Object.assign(new Error("Network connection lost."), { retryable: true }); } });
  assert.equal((await severed.send("/api/ingest/homepod", post({ state: "playing", title: "x" }))).status, 503);
});

test("bodies are bounded by the bytes actually read", async () => {
  const w = world();
  const tooLarge = await w.send("/api/ingest/mac", { body: `"${"x".repeat(STORAGE_MAX_BYTES)}"` });
  assert.equal(tooLarge.status, 400);
  assert.deepEqual(await json(tooLarge), { ok: false, error: "无法读取上报数据" });
  assert.equal(w.calls.commits.length, 0);
});

test("split: server reports bypass the state core and land in the lag layer, the archive and the ledger", async () => {
  const w = world();
  const reporter = { commit: "abc1234", pushes: 3, rttMs: 120, start: Date.now() - 3_600_000, end: Date.now() };
  const response = await w.send("/api/ingest/server", post({ ...server(), reporter }));
  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), { ok: true, data: { id: "misaka-jp" } });
  assert.equal(w.calls.commits.length, 0);
  assert.equal(w.calls.ready, 0);
  assert.equal((await readLag<{ id: string }>(w.lag, LAG_KEYS.server))?.data.id, "misaka-jp");
  assert.equal((await readLag<{ commit: string }>(w.lag, LAG_KEYS.reporterServer))?.data.commit, "abc1234");
  assert.equal(w.calls.archived.length, 1, "server hours go to D1");
  assert.deepEqual(w.calls.revalidated, [[SERVER_TAG]]);
});

test("split: an iPhone report with accepted workouts and rejected rings writes the accepted half, then answers 400", async () => {
  const w = world({ reply: (command) => {
    assert.equal(command.source === "iphone" && command.failure?.stage, "beforeActivity");
    return { ready: true, ok: false, error: "活动上报的 date 必须是 YYYY-MM-DD" };
  } });
  const response = await w.send("/api/ingest/iphone", post({ version: 1, modules: { workouts: { items: [workout()] }, activity: { date: "bad" } } }));
  assert.equal(response.status, 400);
  assert.deepEqual(await json(response), { ok: false, error: "上报数据无效或处理失败" });
  assert.equal(w.calls.commits.length, 1);
  assert.equal((await readLag<{ items: { id: string }[] }>(w.lag, LAG_KEYS.workouts))?.data.items[0]?.id, workout().id);
  assert.equal(await readLag(w.lag, LAG_KEYS.activity), null);
  assert.equal(w.calls.archived.length, 1, "the accepted workouts are archived too");

  const early = world({ reply: () => ({ ready: true, ok: false, error: "Invalid workout identity or activityType" }) });
  assert.equal((await early.send("/api/ingest/iphone", post({ version: 1, modules: { workouts: { items: [workout({ id: "bad" })] } } }))).status, 400);
  assert.equal(early.lag.writes, 0);
  assert.equal(early.calls.archived.length, 0);
});

test("split: Mac credentials and timezone go to their KV namespaces only after the state core accepted", async () => {
  const w = world();
  const response = await w.send("/api/ingest/mac", post(mac({
    timezone: { identifier: "Asia/Tokyo", abbreviation: "JST", secondsFromGMT: 32400 },
    appleMusicCredentials: { musicUserToken: " user-token " },
  })));
  assert.equal(response.status, 202);
  const [command] = w.calls.commits;
  assert.equal(command?.source, "mac");
  const stored = JSON.parse(w.credentials.values.get(CREDENTIAL_KEYS.appleMusic) ?? "null") as { musicUserToken: string; receivedAt: number };
  assert.equal(stored.musicUserToken, "user-token");
  assert.equal(stored.receivedAt, command?.receivedAt);
  assert.equal((await readLag<{ timezone: { identifier: string } }>(w.lag, LAG_KEYS.timezone))?.data.timezone.identifier, "Asia/Tokyo");
  assert.deepEqual(w.calls.revalidated, [], "a timezone change is content, not layout");
});

test("split: agents limits land in the lag layer while the coding half still reaches the state core", async () => {
  const w = world();
  const response = await w.send("/api/ingest/agents", post({
    agents: [{ id: "codex", plan: { tier: "pro" }, limits: [{ key: "codex.primary", usedPercent: 20, windowMinutes: 300 }], limitsError: null }],
    collectedAt: new Date().toISOString(),
    codingActivity: { collectedAt: Date.now(), agents: [{ id: "cursor", lastActivityAt: Date.now() - 5_000, model: "composer-2" }] },
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), { ok: true, data: { accepted: 1, rejected: [] } });
  const [command] = w.calls.commits;
  assert.equal(command?.source === "agents" ? command.codingActivity?.agents[0]?.id : null, "cursor");
  assert.ok((await readLag<{ agents: Record<string, unknown> }>(w.lag, LAG_KEYS.limits))?.data.agents.codex);
  assert.equal(w.calls.archived.length, 1, "limit snapshots are archived");
});

function outcomeFor(title: string): EnrichmentOutcome {
  return {
    enrichment: { trackKey: title, id: "1500", link: "https://music.apple.com/cn/album/x/1500?i=1501", songId: "1501", artwork: null, hasLyrics: true, upcomingSongIds: [], motion: null },
    catalogKnown: true,
    upcomingKnown: true,
    motionKnown: false,
  };
}

test("listening: the collector enriches before the commit and takes the follow-up after the receipt", async () => {
  const w = world({ enrichTrack: async (music) => outcomeFor(music?.title ?? "") });
  const queue = { index: 0, tracks: [{ title: "Song" }, { title: "Next" }] };
  const response = await w.send("/api/ingest/mac", post(mac({ appleMusic: { state: "playing", title: "Song", queue } })));
  assert.equal(response.status, 202);
  const [command] = w.calls.commits;
  assert.ok(command?.source === "mac" && command.modules.appleMusic);
  const { music, upcomingTracks, enrichment } = command.modules.appleMusic;
  assert.equal(music?.title, "Song");
  assert.deepEqual(w.calls.enriched, [[music, upcomingTracks]]);
  assert.deepEqual(upcomingTracks.map((track) => track.title), ["Next"]);
  assert.deepEqual(enrichment, outcomeFor("Song").enrichment);
  assert.deepEqual(w.calls.followUps, [{ target: "mac", music, upcomingTracks, outcome: outcomeFor("Song") }]);

  const homepod = await w.send("/api/ingest/homepod", post({ state: "playing", title: "Pod", artist: "Artist", entityId: "media_player.homepod" }));
  assert.equal(homepod.status, 202);
  const pod = w.calls.commits[1];
  assert.ok(pod?.source === "homepod");
  assert.deepEqual(pod.stored.enrichment, outcomeFor("Pod").enrichment);
  assert.deepEqual(w.calls.followUps[1], { target: "homepod", music: pod.stored.music, upcomingTracks: [], outcome: outcomeFor("Pod") });
});

test("listening: nothing to enrich commits enrichment null; a rejected commit gets no follow-up", async () => {
  const stopped = world();
  assert.equal((await stopped.send("/api/ingest/homepod", post({ state: "idle", entityId: "media_player.homepod" }))).status, 202);
  const [command] = stopped.calls.commits;
  assert.equal(command?.source === "homepod" ? command.stored.enrichment : undefined, null);
  assert.deepEqual(stopped.calls.followUps, []);

  const rejected = world({ enrichTrack: async (music) => outcomeFor(music?.title ?? ""), reply: () => ({ ready: true, ok: false, error: "bad" }) });
  assert.equal((await rejected.send("/api/ingest/homepod", post({ state: "playing", title: "Pod", entityId: "media_player.homepod" }))).status, 400);
  assert.equal(rejected.calls.enriched.length, 1);
  assert.deepEqual(rejected.calls.followUps, []);
});

test("listening: an unreachable collector leaves the command unenriched for the state core, and the report still lands", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const broken = world({ enrichTrack: async () => { throw new Error("Network connection lost."); } });
  assert.equal((await broken.send("/api/ingest/homepod", post({ state: "playing", title: "Pod", entityId: "media_player.homepod" }))).status, 202);
  const [command] = broken.calls.commits;
  assert.ok(command?.source === "homepod");
  assert.equal("enrichment" in command.stored, false);
  assert.deepEqual(broken.calls.followUps, []);
  assert.deepEqual(warned.mock.calls.map((call) => call.arguments), [["[enrichment]", "homepod", "Network connection lost."]]);

  const unbound = world({ collector: false });
  assert.equal((await unbound.send("/api/ingest/mac", post(mac({ appleMusic: { state: "playing", title: "Song" } })))).status, 202);
  const [mac0] = unbound.calls.commits;
  assert.ok(mac0?.source === "mac" && mac0.modules.appleMusic);
  assert.equal("enrichment" in mac0.modules.appleMusic, false);
});

function codingUsage(totalTokens: number) {
  return {
    agents: [{
      id: "claude", state: "ok", collectedAt: Date.now(), sessionCount: 1,
      days: [{
        date: "2026-09-29", inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheCreationTokens: 1, reasoningTokens: 0,
        totalTokens, apiEquivalentCostUSD: 0, costComplete: true, models: [],
      }],
    }],
  };
}

test("receipts: a broken coding module is dropped alone — 202 names it, logs a warning, and the rest of the Mac envelope still commits", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const w = world({ reply: () => ({ ready: true, ok: true, data: { accepted: 2, heartbeat: true } }) });
  const response = await w.send("/api/ingest/mac", post(mac({
    desktop: { applicationName: "Xcode", bundleIdentifier: "com.apple.dt.Xcode", windowTitle: "App.swift" },
    timezone: { identifier: "Asia/Tokyo", abbreviation: "JST", secondsFromGMT: 32400 },
    codingUsage: codingUsage(3),
  })));
  assert.equal(response.status, 202);
  const error = "agents[0].days[0].totalTokens 小于四列之和";
  assert.deepEqual(await json(response), {
    ok: true,
    data: { accepted: 2, heartbeat: true, ignored: [], rejected: [{ module: "codingUsage", error }] },
  });
  const [command] = w.calls.commits;
  assert.equal(command?.source === "mac" ? command.modules.desktop?.activity?.applicationName : null, "Xcode");
  assert.equal(command?.source === "mac" && "codingUsage" in command.modules, false);
  assert.equal((await readLag<{ timezone: { identifier: string } }>(w.lag, LAG_KEYS.timezone))?.data.timezone.identifier, "Asia/Tokyo");
  assert.deepEqual(warned.mock.calls.map((call) => call.arguments), [["[ingest] rejected", "mac", `codingUsage：${error}`]]);
});

test("receipts: modules the ingress does not know (including the renamed vibeCoding*) are echoed back as ignored", async () => {
  const w = world({ reply: () => ({ ready: true, ok: true, data: { accepted: 1, heartbeat: true } }) });
  const response = await w.send("/api/ingest/mac", post(mac({
    vibeCodingNow: { agents: [] },
    codingUsage: codingUsage(10),
  })));
  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), {
    ok: true,
    data: { accepted: 1, heartbeat: true, ignored: ["vibeCodingNow"], rejected: [] },
  });
  const [command] = w.calls.commits;
  assert.deepEqual(command?.source === "mac" ? Object.keys(command.modules) : null, ["codingUsage"]);
});

test("receipts: agents limits still land when only its coding data is broken; nothing usable left is a 400", async (t) => {
  t.mock.method(console, "warn", () => {});
  const errors = t.mock.method(console, "error", () => {});
  const w = world();
  const response = await w.send("/api/ingest/agents", post({
    agents: [{ id: "cursor", plan: { tier: "ultra" }, limits: [] }],
    collectedAt: new Date().toISOString(),
    codingUsage: codingUsage(3),
  }));
  assert.equal(response.status, 202);
  assert.deepEqual(await json(response), {
    ok: true,
    data: { accepted: 1, rejected: [{ module: "codingUsage", error: "agents[0].days[0].totalTokens 小于四列之和" }] },
  });
  assert.ok((await readLag<{ agents: Record<string, unknown> }>(w.lag, LAG_KEYS.limits))?.data.agents.cursor);

  const empty = world();
  const refused = await empty.send("/api/ingest/agents", post({ collectedAt: new Date().toISOString(), codingUsage: codingUsage(3) }));
  assert.equal(refused.status, 400);
  assert.deepEqual(await json(refused), { ok: false, error: "上报数据无效或处理失败" });
  assert.equal(empty.calls.commits.length, 0);
  assert.match(String(errors.mock.calls.at(-1)?.arguments[2]), /^agents 上报没有可收的数据：codingUsage：/);
});

test("prepare runs here: Emby confirms images against R2 before the command leaves", async () => {
  resetStoredImageCacheForTests();
  const w = world();
  const hash = "c".repeat(64);
  const response = await w.send("/api/ingest/emby", post({ images: [{ imageKey: "item:poster", objectKey: `${hash}.webp` }, { imageKey: "junk", objectKey: "nope" }] }));
  assert.equal(response.status, 202);
  assert.deepEqual(w.calls.heads, [`${hash}.webp`]);
  const [command] = w.calls.commits;
  assert.deepEqual(command?.source === "emby" ? command.images : null, [{ key: "item:poster", objectKey: `${hash}.webp` }]);
});

test("every source prepares into a command that survives structured cloning", async () => {
  const images = { head: async () => ({}) };
  const fixtures: [string, unknown][] = [
    ["mac", mac({
      chargingDevices: { devices: [{ id: "charger", kind: "charger", connected: true, updatedAt: Date.now(), totalOutputW: 30 }] },
      desktop: { applicationName: "Xcode", bundleIdentifier: "com.apple.dt.Xcode", windowTitle: "App.swift" },
      appleMusic: { state: "playing", title: "Song", queue: [{ title: "Next" }] },
      codingUsage: codingUsage(10),
      codingActivity: { collectedAt: Date.now(), agents: [{ id: "claude", lastActivityAt: Date.now() - 1_000, model: "claude-opus-5" }] },
      codingTokenBuckets: {
        from: Date.now() - 600_000, to: Date.now(), collectedAt: Date.now(), agents: [{ id: "claude", state: "ok" }],
        windows: [{ from: Math.floor(Date.now() / 300_000) * 300_000 - 300_000, agents: [{
          id: "claude", model: null, inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheCreationTokens: 1, reasoningTokens: 0, eventCount: null,
        }] }],
      },
      vibeCodingNow: { agents: [] },
    })],
    ["iphone", { version: 1, modules: { workouts: { items: [workout()] }, extra: {} } }],
    ["homepod", { state: "playing", title: "Song", artist: "Artist", entityId: "media_player.homepod" }],
    ["emby", { playing: { itemId: "1", paused: false, media: { video: { codec: "hevc" } } }, resume: { items: [{ id: "1", name: "Pilot" }] } }],
    ["playstation", { version: 1, presence: {
      observedAt: Date.now(), online: false, availability: null, platform: null, lastOnlineAt: null, playing: null,
    } }],
    ["server", server()],
    ["agents", { codingActivity: { collectedAt: Date.now(), agents: [{ id: "cursor", lastActivityAt: Date.now(), model: "x" }] }, codingUsage: { bad: true } }],
    ["agents-otlp", { resourceMetrics: [] }],
  ];
  for (const [source, body] of fixtures) {
    const command = await prepareIngest(source, body, Date.now(), images);
    assert.deepEqual(structuredClone(command), command, source);
  }
});

test("PlayStation power 字段直接拒收", async () => {
  await assert.rejects(
    () => prepareIngest("playstation", { version: 1, power: { on: true } }, Date.now()),
    /power 字段不再接受/,
  );
});

test("OTLP: gzip or plain JSON answers the exporter's empty 200; other encodings and bad bodies keep their statuses", async () => {
  const w = world();
  const metrics = JSON.stringify({ resourceMetrics: [] });
  for (const [body, headers] of [
    [metrics, {}],
    [gzipSync(metrics), { "content-encoding": "gzip" }],
    [metrics, { "content-encoding": "identity" }],
  ] as const) {
    const response = await w.send("/api/ingest/agents/otlp", { body: body as BodyInit, headers });
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), {});
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.ok(w.calls.commits.every((command) => command.source === "agents-otlp"));
  const br = await w.send("/api/ingest/agents/otlp", { body: metrics, headers: { "content-encoding": "br" } });
  assert.equal(br.status, 415);
  assert.deepEqual(await json(br), { ok: false, error: "不支持的压缩：br" });
  const badGzip = await w.send("/api/ingest/agents/otlp", { body: "invalid gzip", headers: { "content-encoding": "gzip" } });
  assert.equal(badGzip.status, 400);
  assert.deepEqual(await json(badGzip), { ok: false, error: "无法读取上报数据" });
  const invalid = await w.send("/api/ingest/agents/otlp", { body: "{}" });
  assert.equal(invalid.status, 400, "failures keep the ingest error body, only success becomes {}");
  assert.deepEqual(await json(invalid), { ok: false, error: "上报数据无效或处理失败" });
  assert.equal((await w.send("/api/ingest/mac", { ...post(mac({})), headers: { "content-encoding": "gzip" } })).status, 202);
});

test("site-deployed: the state core broadcasts version and the collector re-pulls deployments and recent commits in the background", async () => {
  const w = world();
  const response = await w.send("/api/internal/site-deployed", { client: DEPLOYER });
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true, delivered: 3 });
  assert.equal(w.calls.broadcasts, 1);
  assert.deepEqual(w.calls.refreshed, [DEPLOYMENT_JOBS]);
  assert.deepEqual(DEPLOYMENT_JOBS, ["site-deployments", "cloudflare-deployments", "github-repo"]);
  assert.equal((await w.send("/api/internal/site-deployed", { method: "GET", client: DEPLOYER })).status, 405);
  assert.equal((await w.send("/api/internal/site-deployed", { client: null })).status, 401);
});

test("site-deployed: a failing or missing collector never fails the notification", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const failing = world({ refresh: async () => { throw new Error("collector unavailable"); } });
  const response = await failing.send("/api/internal/site-deployed", { client: DEPLOYER });
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { ok: true, delivered: 3 });
  const erroring = world({ refresh: async (jobs) => jobs.map((job): CollectorJobOutcome => ({ job, status: "error", detail: "token missing", ms: 1 })) });
  assert.equal((await erroring.send("/api/internal/site-deployed", { client: DEPLOYER })).status, 200);
  assert.equal(warned.mock.callCount(), 1 + DEPLOYMENT_JOBS.length);
  const unbound = world({ collector: false });
  assert.equal((await unbound.send("/api/internal/site-deployed", { client: DEPLOYER })).status, 200);
});

test("collector-refresh: runs every active job now, one collector call per job, and reports each outcome", async () => {
  const w = world();
  const response = await w.send("/api/internal/collector-refresh", { client: DEPLOYER });
  assert.equal(response.status, 200);
  const body = await json(response) as { ok: boolean; outcomes: CollectorJobOutcome[] };
  assert.equal(body.ok, true);
  assert.deepEqual(body.outcomes.map((outcome) => outcome.job), [...ACTIVE_COLLECTOR_JOBS]);
  assert.deepEqual(new Set(w.calls.refreshed.map(([job]) => job)), new Set(ACTIVE_COLLECTOR_JOBS));
  assert.equal(w.calls.refreshed.length, ACTIVE_COLLECTOR_JOBS.length);
  assert.ok(ACTIVE_COLLECTOR_JOBS.includes("digest"));
});

test("collector-refresh: digest starts only after the other jobs have finished writing the views it summarizes", async () => {
  const started: string[] = [];
  const finished: string[] = [];
  const w = world({
    refresh: async ([job]) => {
      started.push(job!);
      await new Promise((resolve) => setTimeout(resolve, job === "github-repo" ? 20 : 1));
      finished.push(job!);
      return [{ job: job!, status: "ok", ms: 1 }];
    },
  });
  const response = await w.send("/api/internal/collector-refresh?job=digest&job=github-repo&job=site-deployments", { client: DEPLOYER });
  assert.deepEqual((await json(response) as { outcomes: CollectorJobOutcome[] }).outcomes.map((outcome) => outcome.job), ["digest", "github-repo", "site-deployments"]);
  assert.equal(started.at(-1), "digest");
  assert.deepEqual(finished.slice(0, 2).sort(), ["github-repo", "site-deployments"]);
});

test("collector-refresh: ?job= narrows the run, and a failing job turns ok false without hiding the rest", async () => {
  const w = world();
  const narrowed = await w.send("/api/internal/collector-refresh?job=digest&job=digest&job=pagespeed", { client: DEPLOYER });
  assert.deepEqual(w.calls.refreshed, [["pagespeed"], ["digest"]]);
  assert.equal((await json(narrowed) as { ok: boolean }).ok, true);

  const failing = world({
    refresh: async ([job]) => {
      if (job === "digest") throw new Error("ai unavailable");
      return [{ job: job!, status: job === "pagespeed" ? "error" : "ok", ms: 1 }];
    },
  });
  const response = await failing.send("/api/internal/collector-refresh?job=digest&job=pagespeed&job=github-chart", { client: DEPLOYER });
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), {
    ok: false,
    outcomes: [
      { job: "digest", status: "error", detail: "ai unavailable", ms: 0 },
      { job: "pagespeed", status: "error", ms: 1 },
      { job: "github-chart", status: "ok", ms: 1 },
    ],
  });
});

test("collector-refresh: POST only, needs its own permission, and says so when the collector is not bound", async () => {
  const w = world();
  assert.equal((await w.send("/api/internal/collector-refresh", { method: "GET", client: DEPLOYER })).status, 405);
  assert.equal((await w.send("/api/internal/collector-refresh", { client: null })).status, 401);
  assert.equal((await w.send("/api/internal/collector-refresh", { client: MAC_ONLY })).status, 403);
  assert.equal((await w.send("/api/internal/collector-refresh", { client: ALL })).status, 403, "report tokens cannot trigger collection");
  assert.equal(w.calls.refreshed.length, 0);
  const unbound = await world({ collector: false }).send("/api/internal/collector-refresh", { client: DEPLOYER });
  assert.equal(unbound.status, 503);
  assert.deepEqual(await json(unbound), { ok: false, error: "没有绑定采集 Worker" });
});
