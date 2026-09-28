import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { HistoryDb } from "@shared/history-ingest";
import type { VercelDeployment } from "@/lib/vercel-deployments-types";

import { archiveSiteDeploys, archiveTrophies, runBatched, trophyStatements } from "./history";
import type { TrophiesReport } from "./playstation/trophies";

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
const counts = { platinum: 0, gold: 0, silver: 0, bronze: 0 };

type Title = TrophiesReport["titles"][number];
type Trophy = Title["trophies"][number];

function trophy(id: number, overrides: Partial<Trophy> = {}): Trophy {
  return {
    id,
    type: "bronze",
    name: `Trophy ${id}`,
    detail: null,
    iconUrl: null,
    hidden: false,
    groupId: "default",
    earned: true,
    earnedAt: T0 - id * 60_000,
    earnedRate: 42.5,
    ...overrides,
  };
}

function title(npCommunicationId: string, trophies: Trophy[], overrides: Partial<Title> = {}): Title {
  return {
    npCommunicationId,
    name: "Horizon Forbidden West",
    localizedName: "地平线 西之绝境",
    titleIds: ["PPSA01521_00", "PPSA01522_00"],
    iconUrl: null,
    platform: "PS5",
    progress: 50,
    defined: counts,
    earned: counts,
    lastUpdatedAt: T0,
    playDurationMs: null,
    playCount: 0,
    firstPlayedAt: null,
    lastPlayedAt: null,
    service: null,
    preOrder: false,
    groups: [],
    trophies,
    ...overrides,
  };
}

function report(titles: Title[], observedAt = T0): TrophiesReport {
  return {
    observedAt,
    profile: {
      onlineId: "someone", avatarUrl: null, plus: true, level: 1, tier: 1, trophyPoint: 0,
      levelBasePoint: 0, levelNextPoint: 0, levelProgress: 0, earned: counts,
    },
    titles,
  };
}

test("only earned trophies are archived, one row per (np communication id, trophy id)", async () => {
  const { db, all } = historyDb();
  await archiveTrophies(db, report([
    title("NPWR20188_00", [trophy(0, { type: "platinum", earned: false, earnedAt: null }), trophy(1), trophy(2, { type: "gold" })]),
    title("NPWR11111_00", [trophy(1, { earnedAt: null })], { titleIds: [], localizedName: null, name: "Astro Bot" }),
  ]));
  assert.deepEqual(all("SELECT np_communication_id, trophy_id, title_id, game_name, trophy_name, grade, earned_at, rarity_percent, platform FROM trophies ORDER BY np_communication_id, trophy_id"), [
    { np_communication_id: "NPWR11111_00", trophy_id: 1, title_id: null, game_name: "Astro Bot", trophy_name: "Trophy 1", grade: "bronze", earned_at: null, rarity_percent: 42.5, platform: "PS5" },
    { np_communication_id: "NPWR20188_00", trophy_id: 1, title_id: "PPSA01521_00", game_name: "地平线 西之绝境", trophy_name: "Trophy 1", grade: "bronze", earned_at: T0 - 60_000, rarity_percent: 42.5, platform: "PS5" },
    { np_communication_id: "NPWR20188_00", trophy_id: 2, title_id: "PPSA01521_00", game_name: "地平线 西之绝境", trophy_name: "Trophy 2", grade: "gold", earned_at: T0 - 120_000, rarity_percent: 42.5, platform: "PS5" },
  ]);
});

test("re-delivering the same catalog writes nothing; a changed rarity rewrites only that row", async () => {
  const { db, all, changes } = historyDb();
  const first = report([title("NPWR20188_00", [trophy(1), trophy(2)])]);
  await archiveTrophies(db, first);
  assert.equal(changes(), 2);

  await archiveTrophies(db, report(first.titles, T0 + 60_000));
  assert.equal(changes(), 2);

  await archiveTrophies(db, report([title("NPWR20188_00", [trophy(1), trophy(2, { earnedRate: 12.3 })])], T0 + 120_000));
  assert.equal(changes(), 3);
  assert.deepEqual(all("SELECT trophy_id, rarity_percent, updated_at FROM trophies ORDER BY trophy_id"), [
    { trophy_id: 1, rarity_percent: 42.5, updated_at: T0 },
    { trophy_id: 2, rarity_percent: 12.3, updated_at: T0 + 120_000 },
  ]);
});

test("large catalogs are committed in batches of at most 100 statements", async () => {
  const { db, all, batches } = historyDb();
  const many = Array.from({ length: 230 }, (_, index) => trophy(index));
  const statements = trophyStatements(db, report([title("NPWR20188_00", many)]));
  await runBatched(db, statements);
  assert.deepEqual(batches, [100, 100, 30]);
  assert.deepEqual(all("SELECT count(*) AS n FROM trophies"), [{ n: 230 }]);
});

test("archive failures are logged, never thrown", async (t) => {
  const logged = t.mock.method(console, "error", () => {});
  const broken: HistoryDb = {
    prepare: () => ({ bind() { return this; } }),
    batch: async () => { throw new Error("D1 down"); },
  };
  await archiveTrophies(broken, report([title("NPWR20188_00", [trophy(1)])]));
  await archiveSiteDeploys(broken, [deployment("dpl_1")], T0);
  assert.equal(logged.mock.callCount(), 2);
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
