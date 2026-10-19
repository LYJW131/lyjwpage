import assert from "node:assert/strict";

import { MemoryKv } from "@shared/testing/memory-kv";
import { type CollectorJobOutcome, type CollectorRpc } from "@shared/collector";
import type { HistoryDb, HistoryStatement } from "@shared/history-ingest";
import { type CoreCommand } from "@shared/ingest/prepare";
import type { CommitReply, StateCoreRpc } from "@shared/state-core";
import type { EnrichmentFollowUp } from "@shared/track-enrichment";

import { DEV_ACCESS_ISSUER } from "../access-auth";
import type { Env } from "../env";
import { handleRequest } from "../worker";

const AUD = "local-dev";
export const ALL = "all.access";
export const MAC_ONLY = "mac-only.access";
export const DEPLOYER = "github-actions.access";
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

export function world(setup: Setup = {}) {
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
    cronRound: async () => { throw new Error("not used"); },
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

export async function json(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

export function mac(modules: Record<string, unknown>, activeModules: string[] = Object.keys(modules)) {
  return { version: 4, presence: "online", heartbeatAt: Date.now(), activeModules, modules };
}

export function server() {
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

export function workout(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111", activityType: "Running",
    startedAt: Date.now() - 3_600_000, endedAt: Date.now() - 1_800_000, durationSeconds: 1_500, secondsFromGMT: 0,
    ...overrides,
  };
}

export const post = (body: unknown) => ({ body: JSON.stringify(body), headers: { "content-type": "application/json" } });

export function codingUsage(totalTokens: number) {
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
