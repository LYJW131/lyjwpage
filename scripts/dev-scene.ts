#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { DigestPayload } from "../shared/digest.ts";
import { STATUS_VIEWS } from "../shared/status-views.ts";
import { TROPHY_CATALOG_OVERRIDE_SEARCH } from "../shared/trophy-slice.ts";
import type { PlaystationGame } from "../shared/types.ts";
import { stampNow } from "../shared/fixture-time.ts";
import { trophiesTilePath } from "../src/lib/paths.ts";
import {
  clearOverride,
  fixturePath,
  listOverrides,
  putOverride,
  readJson,
  SCENES_DIR,
  switchOverrides,
  tokenize,
  WorkerError,
} from "./dev-fixtures.ts";

const USAGE = `用法：
  pnpm dev:scene <场景> [--age <时长>]  清掉现有注入，把场景里的每条端点用同一个 now 一次注入；
                                        --age 20m 把整份快照往回拨（如 30s、20m、2h），造「首屏快照是旧的」「歌已放完」这类态
  pnpm dev:scene --capture <场景> [--from <站点>]
                                        把站点此刻的全部状态视图（连同正在听那首的歌词）抓成场景，
                                        时间改写成相对令牌；默认抓 https://lyjw.me，云端会话加 NODE_USE_ENV_PROXY=1
  pnpm dev:scene --reset                清掉全部注入
  pnpm dev:scene --list                 列出场景

场景放在 workers/core/dev-fixtures/scenes/<场景>.json：
  { "description": "…", "extends": "<另一个场景>", "headline": "<固定的标题>",
    "views": { "<端点路径>": "<夹具.json>" | <信封> | { "fetch": "<注入时现取的地址>" }
                         | { "from": <以上任一种>, "set": { "data.字段.路径": <值> } } } }
  set 只改几个读数派生变体，不用为每个状态复制一份夹具。
注入时摘要卡的三格按场景里的其他视图重算（与 ai Worker 的生成规则同一份代码），标题池收成一句，
SSR、浏览器、明暗两次截图读到的是同一份数据。场景缺的状态视图会列出来：它们仍走生产兜底。`;

export type Envelope = { ok: boolean; [field: string]: unknown };
type FetchEntry = { fetch: string };
type BaseEntry = string | Envelope | FetchEntry;
type PatchEntry = { from: BaseEntry; set: Record<string, unknown> };
export type SceneEntry = BaseEntry | PatchEntry;
export type Scene = { description?: string; extends?: string; headline?: string; views: Record<string, SceneEntry> };

const STATUS_PATHS = Object.values(STATUS_VIEWS).map((view) => view.path);
const DIGEST_PATH = STATUS_VIEWS.digest.path;
const LISTENING_NOW_PATH = STATUS_VIEWS.nowListening.path;
const PLAYING_PATH = STATUS_VIEWS.playing.path;
const PLAYING_NOW_PATH = STATUS_VIEWS.playingNow.path;
export const TROPHY_CATALOG_PATH = `${STATUS_VIEWS.trophies.path}${TROPHY_CATALOG_OVERRIDE_SEARCH}`;
const CAPTURE_TIMEOUT_MS = 20_000;
const LIVE_SITE = "https://lyjw.me";
const SIGNED_URL = /^https:\/\/[^"\s]+[?&]X-Amz-Date=(\d{8}T\d{6}Z)&[^"\s]*X-Amz-Expires=(\d+)/;
const SIGNED_URL_MARGIN_MS = 3_600_000;

class UsageError extends Error {}

function scenePath(name: string): string {
  return path.join(SCENES_DIR, `${name}.json`);
}

export function loadScene(name: string, seen: string[] = []): Scene {
  if (seen.includes(name)) throw new UsageError(`场景循环继承：${[...seen, name].join(" → ")}`);
  const file = scenePath(name);
  if (!fs.existsSync(file)) throw new UsageError(`没有场景 ${name}（${path.relative(process.cwd(), file)}）`);
  const scene = readJson(file) as Scene;
  if (!scene.extends) return scene;
  const base = loadScene(scene.extends, [...seen, name]);
  return { ...base, ...scene, views: { ...base.views, ...scene.views } };
}

const isFetchEntry = (entry: unknown): entry is FetchEntry => typeof (entry as FetchEntry | null)?.fetch === "string";

const isPatchEntry = (entry: unknown): entry is PatchEntry =>
  typeof entry === "object" && entry !== null && "from" in entry && typeof (entry as PatchEntry).set === "object";

export function setPath(target: Envelope, dotted: string, value: unknown): Envelope {
  const copy = structuredClone(target);
  const keys = dotted.split(".");
  let node = copy as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    const next = node[key];
    if (!next || typeof next !== "object") throw new UsageError(`set 的路径 ${dotted} 在 ${key} 处断了`);
    node = next as Record<string, unknown>;
  }
  node[keys.at(-1)!] = value;
  return copy;
}

// { "fetch": url } 在注入时现取：歌词这类不宜进仓库的内容不入库，非信封的响应包一层 ok。
async function resolveEnvelope(entry: SceneEntry): Promise<Envelope> {
  if (isPatchEntry(entry)) {
    const base = await resolveEnvelope(entry.from);
    return Object.entries(entry.set).reduce((envelope, [dotted, value]) => setPath(envelope, dotted, value), base);
  }
  if (isFetchEntry(entry)) {
    const value = await fetchJson(entry.fetch);
    return value && typeof value === "object" && typeof (value as Envelope).ok === "boolean" ? (value as Envelope) : { ok: true, ...(value as object) };
  }
  const value = typeof entry === "string" ? readJson(fixturePath(entry)) : entry;
  if (value && typeof value === "object" && typeof (value as Envelope).ok === "boolean") return value as Envelope;
  throw new UsageError(`不是信封（缺 ok 字段）：${typeof entry === "string" ? entry : JSON.stringify(entry).slice(0, 80)}`);
}

// 摘要的三格出自 ai Worker 同一份规则（facts + situation），这里拿场景里的视图重算，数字与表盘、各卡片才对得上。
async function deriveDigest(views: Map<string, Envelope>, now: number, digest: DigestPayload | null): Promise<DigestPayload | null> {
  const { DIGEST_VIEWS, digestHighlightOptions, digestSignals } = await import("../workers/ai/src/digest/facts.ts");
  const { digestScene } = await import("../workers/ai/src/digest/situation.ts");
  const { taglineCandidates } = await import("../workers/ai/src/digest/compose.ts");
  const inputs = DIGEST_VIEWS.map((key) => [key, views.get(STATUS_VIEWS[key].path)] as const);
  if (inputs.some(([, envelope]) => !envelope?.ok)) return null;
  const digestViews = Object.fromEntries(inputs.map(([key, envelope]) => [key, envelope!.data])) as Parameters<typeof digestSignals>[0];
  const signals = digestSignals(digestViews, now);
  const scene = digestScene(digestHighlightOptions(digestViews), signals);
  if (scene.quiet) return { headline: "", highlights: [], quiet: true, model: digest?.model ?? "rules", generatedAt: now };
  const headline = digest?.headline || taglineCandidates(scene.primary, scene.accents, signals.date)[0] || "";
  return { headline, highlights: scene.highlights, model: digest?.model ?? "rules", generatedAt: digest?.generatedAt ?? now };
}

// 标题池只留一句：首屏内联脚本与客户端轮换都从池里随机取，一句就没得随机。
function pinHeadline(digest: DigestPayload, headline: string | undefined): DigestPayload {
  const line = headline ?? digest.headline;
  return digest.quiet || !line ? digest : { ...digest, headline: line, headlines: [line] };
}

export async function buildScene(scene: Scene, now: number): Promise<{ views: Map<string, Envelope>; missing: string[]; derived: boolean }> {
  const resolved = await Promise.all(Object.entries(scene.views).map(async ([endpoint, entry]) => [endpoint, stampNow(await resolveEnvelope(entry), now) as Envelope] as const));
  const views = new Map(resolved);
  const current = views.get(DIGEST_PATH);
  const stored = current?.ok ? (current.data as DigestPayload) : null;
  const derived = await deriveDigest(views, now, stored);
  const digest = derived ?? stored;
  if (digest) views.set(DIGEST_PATH, { ...(current ?? { ok: true }), ok: true, data: pinHeadline(digest, scene.headline) });
  const songId = listeningSong(views.get(LISTENING_NOW_PATH));
  const lyrics = songId ? `/api/lyrics?song=${songId}` : null;
  const catalog = trophyTitleIds(views).length ? [TROPHY_CATALOG_PATH] : [];
  const missing = [...STATUS_PATHS, ...(lyrics ? [lyrics] : []), ...catalog].filter((endpoint) => !views.has(endpoint));
  return { views, missing, derived: derived !== null };
}

const DURATION = /^(\d+)(ms|s|m|h)?$/;
const UNIT_MS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 } as const;

export function parseDuration(text: string): number {
  const match = DURATION.exec(text.trim());
  if (!match) throw new UsageError(`时长写成 30s、20m、2h 或毫秒数：${text}`);
  return Number(match[1]) * UNIT_MS[(match[2] ?? "ms") as keyof typeof UNIT_MS];
}

export async function applyScene(name: string, ageMs = 0): Promise<unknown> {
  const { views, missing, derived } = await buildScene(loadScene(name), Date.now() - ageMs);
  const signed = await refreshSignedUrls(views, Date.now());
  await switchOverrides(true);
  for (const endpoint of (await listOverrides()).paths) await clearOverride(endpoint);
  await Promise.all([...views].map(([endpoint, envelope]) => putOverride(endpoint, envelope)));
  return {
    ok: true,
    scene: name,
    ...(ageMs ? { agedMs: ageMs } : {}),
    injected: views.size,
    digest: derived ? "derived from scene views" : "kept as written (scene lacks some digest views)",
    unpinned: missing,
    ...(signed.refreshed ? { refreshedSignedUrls: signed.refreshed } : {}),
    ...(signed.expired.length ? { expiredSignedUrls: signed.expired } : {}),
    next: missing.length ? "unpinned 里的视图仍走生产兜底，截图会混入真实数据；要固定就补进场景（--capture 可抓全量）" : undefined,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS) });
  if (!response.ok) throw new WorkerError(`GET ${url} → HTTP ${response.status}`);
  return response.json();
}

export function stripServedAt(envelope: Envelope): Envelope {
  const rest = { ...envelope };
  delete rest.servedAt;
  return rest;
}

// 原始值数组压成一行：Pulse 的列式数组逐项换行会让快照膨胀几倍、diff 也没法看。
export function formatScene(scene: Scene): string {
  const pretty = JSON.stringify(scene, null, 2).replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, items: string) => `[${items.replace(/\n\s*/g, " ")}]`);
  return `${pretty}\n`;
}

// 奖杯明细按 ?titleids= 查，组合随可见瓷砖变；场景注入整份目录，core 按请求现切（public-api.ts#matchOverride）。
export function trophyTitleIds(views: Map<string, Envelope> | Record<string, Envelope>): string[] {
  const get = (endpoint: string) => (views instanceof Map ? views.get(endpoint) : views[endpoint]);
  const list = get(PLAYING_PATH);
  const games = list?.ok ? ((list.data as { items?: PlaystationGame[] } | null)?.items ?? []) : [];
  const presence = get(PLAYING_NOW_PATH);
  const live = presence?.ok ? (presence.data as { playing?: { titleId?: string } | null } | null)?.playing?.titleId : undefined;
  return [...new Set([...games.map((game) => game.titleId), ...(live ? [live] : [])])];
}

function signedExpiry(value: string): number | null {
  const match = SIGNED_URL.exec(value);
  if (!match) return null;
  const [, date, seconds] = match;
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`;
  return Date.parse(iso) + Number(seconds) * 1_000;
}

function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, into));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, into));
  return into;
}

function replaceStrings(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, map));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceStrings(item, map)]));
  return value;
}

const unsigned = (url: string) => url.split("?")[0];

// Apple 歌单封面是带时效签名的直链，抓下来一天后就打不开；注入前对快到期的，按去掉签名的地址从线上同一视图换新链。
async function refreshSignedUrls(views: Map<string, Envelope>, now: number): Promise<{ refreshed: number; expired: string[] }> {
  let refreshed = 0;
  const expired: string[] = [];
  for (const [endpoint, envelope] of views) {
    const stale = collectStrings(envelope).filter((value) => (signedExpiry(value) ?? Infinity) < now + SIGNED_URL_MARGIN_MS);
    if (!stale.length) continue;
    const live = await fetchJson(`${LIVE_SITE}${endpoint}`).catch(() => null);
    const fresh = new Map(
      collectStrings(live)
        .filter((value) => (signedExpiry(value) ?? 0) >= now + SIGNED_URL_MARGIN_MS)
        .map((value) => [unsigned(value), value]),
    );
    const map = new Map(stale.flatMap((value) => (fresh.has(unsigned(value)) ? [[value, fresh.get(unsigned(value))!] as const] : [])));
    refreshed += map.size;
    if (map.size < stale.length) expired.push(endpoint);
    if (map.size) views.set(endpoint, replaceStrings(envelope, map) as Envelope);
  }
  return { refreshed, expired };
}

function listeningSong(envelope: Envelope | undefined): string | null {
  const songId = envelope?.ok ? (envelope.data as { songId?: unknown } | null)?.songId : null;
  return typeof songId === "string" && songId ? songId : null;
}

async function captureScene(name: string, from: string): Promise<unknown> {
  const base = from.replace(/\/+$/, "");
  const capturedAt = Date.now();
  const entries = await Promise.all(STATUS_PATHS.map(async (endpoint) => [endpoint, stripServedAt((await fetchJson(`${base}${endpoint}`)) as Envelope)] as const));
  const views: Record<string, Envelope> = Object.fromEntries(entries);
  const songId = listeningSong(views[LISTENING_NOW_PATH]);
  if (songId) {
    const lyrics = await fetchJson(`${base}/api/lyrics?song=${encodeURIComponent(songId)}`).catch(() => null);
    if (lyrics && typeof lyrics === "object") views[`/api/lyrics?song=${songId}`] = { ok: true, ...(lyrics as object) };
  }
  const titleIds = trophyTitleIds(views);
  if (titleIds.length) views[TROPHY_CATALOG_PATH] = stripServedAt((await fetchJson(`${base}${trophiesTilePath(titleIds)}`)) as Envelope);
  const scene: Scene = {
    description: `${base} 于 ${new Date(capturedAt).toISOString()} 的全部状态视图；时间已改写成相对令牌`,
    views: tokenize(views, capturedAt) as Record<string, Envelope>,
  };
  fs.mkdirSync(SCENES_DIR, { recursive: true });
  fs.writeFileSync(scenePath(name), formatScene(scene));
  return { ok: true, scene: name, file: path.relative(process.cwd(), scenePath(name)), views: Object.keys(views).length };
}

async function reset(): Promise<unknown> {
  const { paths } = await listOverrides();
  for (const endpoint of paths) await clearOverride(endpoint);
  return { ok: true, cleared: paths };
}

function listScenes(): unknown {
  const names = fs.existsSync(SCENES_DIR) ? fs.readdirSync(SCENES_DIR).filter((file) => file.endsWith(".json")) : [];
  return names.map((file) => {
    const scene = readJson(path.join(SCENES_DIR, file)) as Scene;
    return { scene: file.slice(0, -".json".length), extends: scene.extends, description: scene.description };
  });
}

async function main(args: string[]): Promise<unknown> {
  const [first, second] = args;
  if (first === "--reset") return reset();
  if (first === "--list") return listScenes();
  if (first === "--capture") {
    if (!second) throw new UsageError("--capture 要给场景名");
    const fromIndex = args.indexOf("--from");
    return captureScene(second, fromIndex > 0 ? args[fromIndex + 1] : LIVE_SITE);
  }
  if (!first || first.startsWith("--")) throw new UsageError(USAGE);
  const ageIndex = args.indexOf("--age");
  return applyScene(first, ageIndex > 0 ? parseDuration(args[ageIndex + 1] ?? "") : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === "--help") console.log(USAGE);
    else console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(error instanceof UsageError ? 2 : 1);
  }
}
