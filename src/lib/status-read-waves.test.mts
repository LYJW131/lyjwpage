import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { getChargerSnapshot } from "@/lib/anker";
import { getNowWatching, getWatching } from "@/lib/emby";
import { getPowerBankSnapshot } from "@/lib/powerbank";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { getNowListening } from "@/lib/telemetry";
import { getTrophies } from "@/lib/trophies";
import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";

// Worker 只把同一轮发出的读取合成一次 StateHub RPC；互不依赖的读取必须在第一轮全部发出。
async function firstWaveKeys(load: () => Promise<unknown>): Promise<Set<string>> {
  const pending: { commands: StorageCommand[]; release: () => void }[] = [];
  installStorageForTests(new StorageClient((commands) => new Promise((resolve) => {
    pending.push({ commands, release: () => resolve(commands.map((command) => (command.op === "fields" ? {} : command.op === "listRange" ? [] : null))) });
  })));
  try {
    const settled = load().catch(() => {});
    await setImmediate();
    const keys = new Set(pending.flatMap((call) => call.commands.map((command) => command.key)));
    for (let drained = 0; drained < pending.length; drained += 1) pending[drained]!.release();
    await settled;
    return keys;
  } finally {
    resetStorageForTests();
  }
}

for (const [name, load, independentReads] of [
  ["charger", getChargerSnapshot, 4],
  ["powerbank", getPowerBankSnapshot, 3],
  ["listening/now", getNowListening, 4],
  ["watching", () => getWatching(), 2],
  ["watching/now", getNowWatching, 3],
  ["trophies", getTrophies, 2],
] as const) {
  test(`${name} 的独立读取在第一轮全部发出`, async () => {
    assert.equal((await firstWaveKeys(load)).size, independentReads);
  });
}
