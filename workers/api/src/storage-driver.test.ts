import assert from "node:assert/strict";
import test from "node:test";
import type { StorageCommand, StorageResult } from "@shared/storage-contract";
import { createPublicStorage } from "./storage-driver";

function harness(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const calls: { kind: "read" | "execute"; commands: StorageCommand[] }[] = [];
  function answer(command: StorageCommand): StorageResult {
    switch (command.op) {
      case "get": return values.get(command.key) ?? null;
      case "set": values.set(command.key, command.value); return true;
      case "remove": return values.delete(command.key) ? 1 : 0;
      case "fields": return {};
      case "listRange": return [];
      case "patch": return Object.keys(command.fields).length;
      case "append": return command.values.length;
      case "trim": return true;
      case "expire": return values.has(command.key) ? 1 : 0;
    }
  }
  const hub = {
    async publicRead(commands: StorageCommand[]): Promise<StorageResult[]> {
      calls.push({ kind: "read", commands });
      if (commands.length > 128) throw new Error("Invalid storage batch");
      return commands.map(answer);
    },
    async execute(commands: StorageCommand[]): Promise<StorageResult[]> {
      calls.push({ kind: "execute", commands });
      return commands.map(answer);
    },
  };
  return { calls, storage: createPublicStorage(hub), values };
}

test("public storage coalesces adjacent reads and preserves result slices", async () => {
  const { calls, storage } = harness({ a: "A", b: "B", c: "C" });
  const [first, second] = await Promise.all([
    storage.batch().get("a").get("b").execute(),
    storage.batch().get("c").execute(),
  ]);
  assert.deepEqual(first, ["A", "B"]);
  assert.deepEqual(second, ["C"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.commands.map((command) => command.key), ["a", "b", "c"]);
});

test("public storage keeps read, write, read submission order", async () => {
  const { calls, storage } = harness({ key: "before" });
  const [before, written, after] = await Promise.all([
    storage.get("key"),
    storage.set("key", "after"),
    storage.get("key"),
  ]);
  assert.deepEqual([before, written, after], ["before", true, "after"]);
  assert.deepEqual(calls.map((call) => call.kind), ["read", "execute", "read"]);
});

test("public storage splits a coalesced read turn at the 128-command protocol limit", async () => {
  const initial = Object.fromEntries(Array.from({ length: 130 }, (_, index) => [`k${index}`, `v${index}`]));
  const { calls, storage } = harness(initial);
  const results = await Promise.all(Array.from({ length: 130 }, (_, index) => storage.get(`k${index}`)));
  assert.deepEqual(results, Array.from({ length: 130 }, (_, index) => `v${index}`));
  assert.deepEqual(calls.map((call) => call.commands.length), [128, 2]);
  assert.ok(calls.every((call) => call.kind === "read"));
});

test("public storage leaves an oversized original batch for the protocol to reject", async () => {
  const { calls, storage } = harness();
  const batch = storage.batch();
  for (let index = 0; index < 129; index += 1) batch.get(`k${index}`);
  await assert.rejects(batch.execute(), /Invalid storage batch/);
  assert.deepEqual(calls.map((call) => call.commands.length), [129]);
});
