import assert from "node:assert/strict";
import test from "node:test";

import type { Cache, ScopedMutator } from "swr";

import { trophiesTilePath } from "@/lib/paths";
import { fetchCatalog, prefetchCatalogs } from "@/lib/trophy-catalog";
import type { TrophiesPayload, TrophyTitle } from "@/lib/types";

process.env.NEXT_PUBLIC_BACKEND_URL = "https://api.test";

function title(npCommunicationId: string, titleIds: string[]): TrophyTitle {
  return { npCommunicationId, titleIds, groups: [], trophies: [] } as unknown as TrophyTitle;
}

const PAYLOAD: TrophiesPayload = {
  observedAt: 1,
  profile: {} as TrophiesPayload["profile"],
  titles: [title("NPWR1", ["A"]), title("NPWR2", ["B1", "B2"])],
};

function stubFetch(respond: (url: string) => Response | Promise<Response>): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return respond(url);
  }) as typeof fetch;
  return urls;
}

function swrStore() {
  const entries = new Map<string, { data?: unknown }>();
  const cache = { get: (key: string) => entries.get(key) } as unknown as Cache;
  const mutate = (async (key: string, data: unknown) => {
    entries.set(key, { data });
  }) as unknown as ScopedMutator;
  return { cache, mutate, entries };
}

test("瓷砖目录并成一次请求，按瓷砖切片写入缓存", async () => {
  const urls = stubFetch(() => Response.json({ ok: true, data: PAYLOAD }));
  const { cache, mutate, entries } = swrStore();

  await prefetchCatalogs([["A"], ["B2", "B1"]], cache, mutate);

  assert.equal(urls.length, 1);
  const a = entries.get(trophiesTilePath(["A"]))?.data as { data: TrophiesPayload };
  const b = entries.get(trophiesTilePath(["B1", "B2"]))?.data as { data: TrophiesPayload };
  assert.deepEqual(a.data.titles.map((t) => t.npCommunicationId), ["NPWR1"]);
  assert.deepEqual(b.data.titles.map((t) => t.npCommunicationId), ["NPWR2"]);

  assert.equal(prefetchCatalogs([["A"]], cache, mutate), null);
  assert.equal(urls.length, 1);
});

test("展开时批量请求仍在途，就等它而不另发请求", async () => {
  let release: (response: Response) => void = () => {};
  const urls = stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));
  const { cache, mutate, entries } = swrStore();

  const batch = prefetchCatalogs([["A"], ["B1", "B2"]], cache, mutate);
  const opened = fetchCatalog(trophiesTilePath(["A"]));
  release(Response.json({ ok: true, data: PAYLOAD }));
  const envelope = await opened;
  await batch;

  assert.equal(urls.length, 1);
  assert.ok(envelope.ok);
  assert.deepEqual(envelope.data.titles.map((t) => t.npCommunicationId), ["NPWR1"]);
  assert.equal(entries.has(trophiesTilePath(["A"])), false);
  assert.equal(entries.has(trophiesTilePath(["B1", "B2"])), true);
});

test("批量请求失败时展开改走单块请求，失败不写缓存", async () => {
  const urls = stubFetch((url) =>
    url.includes(encodeURIComponent("A,B1"))
      ? new Response("down", { status: 503 })
      : Response.json({ ok: true, data: { ...PAYLOAD, titles: [PAYLOAD.titles[0]] } }),
  );
  const { cache, mutate, entries } = swrStore();

  const batch = prefetchCatalogs([["A"], ["B1"]], cache, mutate);
  const envelope = await fetchCatalog(trophiesTilePath(["A"]));
  await batch;

  assert.equal(urls.length, 2);
  assert.ok(envelope.ok);
  assert.equal(entries.size, 0);
});
