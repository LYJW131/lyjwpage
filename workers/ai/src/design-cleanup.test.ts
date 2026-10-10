import assert from "node:assert/strict";
import test from "node:test";

import { BUILD_DESIGN_LIMITS } from "@shared/build-routine";

import { DESIGN_SESSION_GRACE_MS, deleteExpiredDesignSessions } from "./chat/design-cleanup.ts";
import type { Env } from "./runtime.ts";

type Listed = { id: string; status: string };

function fakeSessions(listed: Listed[]) {
  const queries: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const sessions = {
    list: (query: Record<string, unknown>) => {
      queries.push(query);
      return (async function* () { yield* listed; })();
    },
    delete: async (id: string) => { deleted.push(id); return { id, type: "session_deleted" }; },
  } as unknown as Parameters<typeof deleteExpiredDesignSessions>[0];
  return { sessions, queries, deleted };
}

test("只删设计 agent 下令牌过期又过了宽限期的会话，还在跑的留到下一轮", async () => {
  const now = Date.UTC(2026, 9, 11, 12);
  const { sessions, queries, deleted } = fakeSessions([
    { id: "sesn_idle", status: "idle" },
    { id: "sesn_running", status: "running" },
    { id: "sesn_ended", status: "terminated" },
  ]);
  assert.equal(await deleteExpiredDesignSessions(sessions, { DESIGN_AGENT_ID: "agent_design" } as Env, now), 2);
  assert.deepEqual(deleted, ["sesn_idle", "sesn_ended"]);
  assert.equal(queries[0].agent_id, "agent_design");
  assert.equal(queries[0]["created_at[lt]"], new Date(now - BUILD_DESIGN_LIMITS.ttlMs - DESIGN_SESSION_GRACE_MS).toISOString());
  assert.equal(queries[0].include_archived, true);
});

test("没配设计 agent 时不列也不删", async () => {
  const { sessions, queries, deleted } = fakeSessions([{ id: "sesn_other", status: "idle" }]);
  assert.equal(await deleteExpiredDesignSessions(sessions, {} as Env), 0);
  assert.deepEqual([queries.length, deleted.length], [0, 0]);
});
