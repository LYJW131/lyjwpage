import assert from "node:assert/strict";
import { test } from "node:test";

import { LAG_KEYS, readLag, writeLag } from "@shared/lag";
import type { AgentStatusPayload, AgentStatusRow } from "@shared/agent-status-types";

import { MemoryKv } from "../testing/memory-kv";
import { refreshProviderStatus } from "./provider-status";

function row(id: AgentStatusRow["id"], indicator: AgentStatusRow["indicator"]): AgentStatusRow {
  return { id, name: id, indicator, statusUrl: `https://status.example/${id}`, components: [], incidents: [], note: null, stale: false } as AgentStatusRow;
}

function statusPayload(fetchedAt: number, indicator: AgentStatusRow["indicator"]): AgentStatusPayload {
  return { fetchedAt, agents: [row("claude", indicator), row("github", "operational")] };
}

test("provider status writes every round, revalidates only when the lights change", async () => {
  const lag = new MemoryKv();
  const revalidated: string[][] = [];
  const core = { revalidate: async (tags: string[]) => { revalidated.push(tags); } };
  const seen: (AgentStatusPayload | null)[] = [];
  const memo = {};
  let indicator: AgentStatusRow["indicator"] = "operational";
  const collect = async (previous: AgentStatusPayload | null, now: number) => {
    seen.push(previous);
    return statusPayload(now, indicator);
  };

  assert.deepEqual(await refreshProviderStatus({ lag, core, collect, memo }, 1_000), { status: "ok", detail: "changed" });
  assert.deepEqual(revalidated, [["agent-status"]]);
  assert.equal(seen[0], null);

  assert.deepEqual(await refreshProviderStatus({ lag, core, collect, memo }, 61_000), { status: "ok" });
  assert.equal(revalidated.length, 1);
  assert.equal(seen[1]?.fetchedAt, 1_000, "上一轮取自可滞后层");
  assert.equal((await readLag<AgentStatusPayload>(lag, LAG_KEYS.agentStatus))?.updatedAt, 61_000);

  indicator = "major_outage";
  await refreshProviderStatus({ lag, core, collect, memo }, 121_000);
  assert.equal(revalidated.length, 2);
});

test("provider status prefers its own newer write over a lagging KV read", async () => {
  const lag = new MemoryKv();
  const core = { revalidate: async () => {} };
  const memo = {};
  const seen: (AgentStatusPayload | null)[] = [];
  const collect = async (previous: AgentStatusPayload | null, now: number) => {
    seen.push(previous);
    return statusPayload(now, "operational");
  };
  await refreshProviderStatus({ lag, core, collect, memo }, 1_000);
  await writeLag(lag, LAG_KEYS.agentStatus, statusPayload(500, "major_outage"), 500);
  await refreshProviderStatus({ lag, core, collect, memo }, 61_000);
  assert.equal(seen[1]?.fetchedAt, 1_000);
});

test("a failed revalidation does not fail the round; a failed collection does not overwrite", async (t) => {
  t.mock.method(console, "warn", () => {});
  const lag = new MemoryKv();
  const core = { revalidate: async () => { throw new Error("core down"); } };
  const memo = {};
  const result = await refreshProviderStatus({ lag, core, memo, collect: async (_, now) => statusPayload(now, "operational") }, 5_000);
  assert.equal(result.detail, "changed");
  assert.equal((await readLag<AgentStatusPayload>(lag, LAG_KEYS.agentStatus))?.updatedAt, 5_000);

  await assert.rejects(refreshProviderStatus({ lag, core, memo, collect: async () => { throw new Error("boom"); } }, 9_000));
  assert.equal((await readLag<AgentStatusPayload>(lag, LAG_KEYS.agentStatus))?.updatedAt, 5_000);
});
