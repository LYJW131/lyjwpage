import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { HistoryDb } from "@shared/history-ingest";
import type { VercelDeployment } from "@/lib/vercel-deployments-types";

import { archiveSiteDeploys } from "./history";

type Statement = { query: string; values: unknown[] };

/** 真实 SQLite 跑 api 的全部迁移：upsert 的冲突与「没变不写」要在引擎里验，不在替身里推断 */
function historyDb() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = `${dirname(fileURLToPath(import.meta.url))}/../../api/migrations/`;
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${migrations}${file}`, "utf8"));
  }
  let changes = 0;
  const batches: number[] = [];
  const db: HistoryDb = {
    prepare: (query) => {
      const statement: Statement & { bind(...values: unknown[]): typeof statement } = {
        query,
        values: [],
        bind: (...values) => ({ ...statement, values }),
      };
      return statement;
    },
    async batch(statements) {
      batches.push(statements.length);
      sqlite.exec("BEGIN");
      for (const { query, values } of statements as unknown as Statement[]) {
        changes += Number(sqlite.prepare(query).run(...(values as (string | number | null)[])).changes);
      }
      sqlite.exec("COMMIT");
      return [];
    },
  };
  return { db, all: (query: string) => sqlite.prepare(query).all().map((row) => ({ ...row })), changes: () => changes, batches };
}

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

function deployment(id: string, overrides: Partial<VercelDeployment> = {}): VercelDeployment {
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

  // 同一份列表下一分钟再来一遍：没有写入
  await archiveSiteDeploys(db, [deployment("dpl_1"), building], T0 + 120_000);
  assert.equal(changes(), 2);

  // 构建完成：只改写那一行
  await archiveSiteDeploys(db, [null, deployment("dpl_1"), { ...building, state: "READY", buildDurationMs: 50_000 }], T0 + 180_000);
  assert.equal(changes(), 3);
  assert.deepEqual(all("SELECT id, state, build_duration_ms, target, commit_sha, updated_at FROM site_deploys ORDER BY id"), [
    { id: "dpl_1", state: "READY", build_duration_ms: 45_000, target: "production", commit_sha: "a".repeat(40), updated_at: T0 + 60_000 },
    { id: "dpl_2", state: "READY", build_duration_ms: 50_000, target: "preview", commit_sha: null, updated_at: T0 + 180_000 },
  ]);
});
