import assert from "node:assert/strict";
import test from "node:test";

import type { HistoryDb } from "@shared/history-ingest";
import type { SiteDeployment } from "@shared/site-deployments-types";

import { archiveSiteDeploys } from "./history";
import { historyDb } from "./testing/sqlite-history";

const T0 = Date.UTC(2026, 8, 28, 3, 0, 0);

test("site deploy archive failures are logged, never thrown", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const broken: HistoryDb = {
    prepare: () => ({ bind() { return this; } }),
    batch: async () => { throw new Error("D1 down"); },
  };
  await archiveSiteDeploys(broken, [deployment("dpl_1")], T0);
  assert.equal(logged.mock.callCount(), 1);
});

function deployment(id: string, overrides: Partial<SiteDeployment> = {}): SiteDeployment {
  return {
    id,
    state: "READY",
    createdAt: T0,
    buildDurationMs: 45_000,
    target: "production",
    commit: { sha: "a".repeat(40), branch: "main", message: "feat: x" },
    ...overrides,
  };
}

test("site deploys upsert by id, dedupe production against recent, and only rewrite changed rows", async () => {
  const { db, all, changes } = historyDb();
  const building = deployment("dpl_2", { state: "BUILDING", buildDurationMs: null, createdAt: T0 + 60_000, target: "preview", commit: null });
  await archiveSiteDeploys(db, [deployment("dpl_1"), deployment("dpl_1"), building], T0 + 60_000);
  assert.equal(changes(), 2);

  await archiveSiteDeploys(db, [deployment("dpl_1"), building], T0 + 120_000);
  assert.equal(changes(), 2);

  await archiveSiteDeploys(db, [null, deployment("dpl_1"), { ...building, state: "READY", buildDurationMs: 50_000 }], T0 + 180_000);
  assert.equal(changes(), 3);
  assert.deepEqual(all("SELECT id, state, build_duration_ms, target, commit_sha, updated_at FROM site_deploys ORDER BY id"), [
    { id: "dpl_1", state: "READY", build_duration_ms: 45_000, target: "production", commit_sha: "a".repeat(40), updated_at: T0 + 60_000 },
    { id: "dpl_2", state: "READY", build_duration_ms: 50_000, target: "preview", commit_sha: null, updated_at: T0 + 180_000 },
  ]);
});
