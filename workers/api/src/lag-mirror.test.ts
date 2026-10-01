import assert from "node:assert/strict";
import test from "node:test";
import { codingViewKey, codingYearKey } from "@shared/coding-store";
import { LAG_KEYS, type LagStore } from "@shared/lag";
import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";
import { flushLagMirrors, markAllLagPending, markLagPending } from "./lag-mirror";

function memoryStorage() {
  const map = new Map<string, string>();
  const client = new StorageClient(async (commands: StorageCommand[]) => commands.map((command) => {
    if (command.op === "get") return map.get(command.key) ?? null;
    if (command.op === "set") return map.set(command.key, command.value) && true;
    if (command.op === "remove") return map.delete(command.key) ? 1 : 0;
    throw new Error(`unexpected ${command.op}`);
  }));
  return { map, client };
}

function memoryKv(fail = false) {
  const puts = new Map<string, string>();
  const kv: LagStore = {
    get: async (key) => puts.get(key) ?? null,
    put: async (key, value) => {
      if (fail) throw new Error("429");
      puts.set(key, value);
    },
  };
  return { puts, kv };
}

const view = JSON.stringify({ agents: [], topModels: [], updatedAt: 1 });
const year = JSON.stringify({ updatedAt: 1, days: {} });

test("只写带待写标记的镜像，写成后清标记", async () => {
  const { map, client } = memoryStorage();
  map.set(codingViewKey(), view);
  map.set(codingYearKey(), year);
  await markLagPending(client.batch(), LAG_KEYS.codingUsage).execute();
  const { puts, kv } = memoryKv();

  assert.equal(await flushLagMirrors(client, kv, 5), false);
  assert.deepEqual([...puts.keys()], [LAG_KEYS.codingUsage]);
  assert.deepEqual(JSON.parse(puts.get(LAG_KEYS.codingUsage)!), { updatedAt: 5, data: JSON.parse(view) });

  puts.clear();
  assert.equal(await flushLagMirrors(client, kv, 6), false);
  assert.equal(puts.size, 0);
});

test("KV 写失败保留标记，下次补写", async () => {
  const { map, client } = memoryStorage();
  map.set(codingViewKey(), view);
  map.set(codingYearKey(), year);
  await markAllLagPending(client.batch()).execute();

  assert.equal(await flushLagMirrors(client, memoryKv(true).kv), true);
  const { puts, kv } = memoryKv();
  assert.equal(await flushLagMirrors(client, kv), false);
  assert.deepEqual([...puts.keys()].sort(), [LAG_KEYS.codingUsage, LAG_KEYS.codingYear].sort());
});

test("没有 KV 绑定时不动标记", async () => {
  const { map, client } = memoryStorage();
  await markAllLagPending(client.batch()).execute();
  const before = map.size;
  assert.equal(await flushLagMirrors(client, undefined), false);
  assert.equal(map.size, before);
});
