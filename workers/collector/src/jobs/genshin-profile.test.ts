import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { LAG_KEYS, readLag, type GenshinProfile } from "@shared/lag";

import { resetSkipWarningsForTests } from "../job";
import { MemoryKv } from "../testing/memory-kv";
import { refreshGenshinProfile, resetGenshinWarningsForTests } from "./genshin-profile";

const UID = "123456789";

const playerInfo = {
  nickname: "LYJW",
  level: 60,
  signature: "hello",
  worldLevel: 9,
  nameCardId: 210001,
  finishAchievementNum: 1234,
  towerFloorIndex: 12,
  towerLevelIndex: 3,
  theaterActIndex: 8,
  profilePicture: { id: 1 },
  showAvatarInfoList: [{ avatarId: 10000002, level: 90 }],
};

function enka(response: () => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response();
  }) as typeof fetch;
  return { fetcher, calls };
}

function core() {
  const revalidated: string[][] = [];
  return { revalidated, core: { revalidate: async (tags: string[]) => { revalidated.push(tags); } } };
}

function captureWarns(): { warns: string[]; restore: () => void } {
  const original = console.warn;
  const warns: string[] = [];
  console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(" ")); };
  return { warns, restore: () => { console.warn = original; } };
}

afterEach(() => {
  resetSkipWarningsForTests();
  resetGenshinWarningsForTests();
});

test("genshin-profile skips without fetching when GENSHIN_UID is missing or invalid, warning once per isolate", async () => {
  const lag = new MemoryKv();
  const { fetcher, calls } = enka(() => Response.json({ playerInfo }));
  const { core: rpc } = core();
  const { warns, restore } = captureWarns();
  try {
    for (const uid of [undefined, "", "  "]) {
      const result = await refreshGenshinProfile({ uid, lag, core: rpc, fetcher });
      assert.equal(result.status, "skipped");
    }
    for (const uid of ["12345", "abc123456", "12345678901"]) {
      const result = await refreshGenshinProfile({ uid, lag, core: rpc, fetcher });
      assert.deepEqual(result, { status: "skipped", detail: "invalid GENSHIN_UID" });
    }
  } finally {
    restore();
  }
  assert.equal(calls.length, 0);
  assert.equal(lag.puts.length, 0);
  assert.equal(warns.length, 2);
  for (const warn of warns) {
    assert.equal(JSON.parse(warn).event, "collector-skip");
    assert.equal(JSON.parse(warn).job, "genshin-profile");
    assert.doesNotMatch(warn, /12345/);
  }
});

test("genshin-profile writes only the public fields and revalidates on the first write only", async () => {
  const lag = new MemoryKv();
  const { fetcher, calls } = enka(() => Response.json({ playerInfo, ttl: 60, uid: UID }));
  const { core: rpc, revalidated } = core();

  assert.deepEqual(await refreshGenshinProfile({ uid: UID, lag, core: rpc, fetcher }, 1_000), { status: "ok", detail: "appeared" });
  assert.equal(calls[0].url, `https://enka.network/api/uid/${UID}?info`);
  assert.equal(new Headers(calls[0].init?.headers).get("user-agent"), "lyjwpage-collector (+https://lyjw.me)");
  assert.ok(calls[0].init?.signal, "the request has a timeout");

  const stored = await readLag<GenshinProfile>(lag, LAG_KEYS.genshin);
  assert.equal(stored?.updatedAt, 1_000);
  assert.deepEqual(stored?.data, {
    nickname: "LYJW",
    adventureRank: 60,
    worldLevel: 9,
    achievements: 1234,
    abyss: { floor: 12, chamber: 3 },
    theaterAct: 8,
  });
  assert.doesNotMatch(lag.raw(LAG_KEYS.genshin) ?? "", new RegExp(UID));
  assert.deepEqual(revalidated, [["genshin"]]);

  assert.deepEqual(await refreshGenshinProfile({ uid: UID, lag, core: rpc, fetcher }, 3_601_000), { status: "ok" });
  assert.equal((await readLag<GenshinProfile>(lag, LAG_KEYS.genshin))?.updatedAt, 3_601_000);
  assert.equal(revalidated.length, 1);
});

test("genshin-profile leaves the previous value alone when Enka fails, times out or returns malformed JSON", async () => {
  const failures: [string, () => Response | Promise<Response>][] = [
    ["400", () => new Response("bad uid", { status: 400 })],
    ["404", () => new Response("not found", { status: 404 })],
    ["424", () => new Response("maintenance", { status: 424 })],
    ["429", () => new Response("slow down", { status: 429 })],
    ["500", () => new Response("oops", { status: 500 })],
    ["malformed", () => new Response("{not json", { status: 200, headers: { "content-type": "application/json" } })],
    ["no playerInfo", () => Response.json({ uid: UID })],
  ];
  for (const [name, response] of failures) {
    const lag = new MemoryKv();
    const { core: rpc, revalidated } = core();
    await refreshGenshinProfile({ uid: UID, lag, core: rpc, fetcher: enka(() => Response.json({ playerInfo })).fetcher }, 1_000);
    const before = lag.raw(LAG_KEYS.genshin);
    await assert.rejects(refreshGenshinProfile({ uid: UID, lag, core: rpc, fetcher: enka(response).fetcher }, 2_000), name);
    assert.equal(lag.raw(LAG_KEYS.genshin), before, name);
    assert.equal(lag.puts.length, 1, name);
    assert.equal(revalidated.length, 1, name);
  }

  const lag = new MemoryKv();
  const hanging = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as typeof fetch;
  const { core: rpc } = core();
  // Node 里 AbortSignal.timeout 的计时器不占事件循环，没有别的计时器时测试会被提前取消。
  const keepAlive = setTimeout(() => {}, 5_000);
  try {
    await assert.rejects(refreshGenshinProfile({ uid: UID, lag, core: rpc, fetcher: hanging, timeoutMs: 20 }), /timeout|abort/i);
  } finally {
    clearTimeout(keepAlive);
  }
  assert.equal(lag.puts.length, 0);
});
