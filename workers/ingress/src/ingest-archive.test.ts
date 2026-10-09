import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { siteDay, type HistoryDb } from "@shared/history-ingest";
import type { ReportedWorkout, ServerStatus } from "@/lib/types";
import { archiveIngest } from "./ingest-archive";
import type { PreparedIngest } from "@shared/ingest/prepare";

type Statement = { query: string; values: unknown[] };

function historyDb() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = `${dirname(fileURLToPath(import.meta.url))}/../../api/migrations/`;
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`${migrations}${file}`, "utf8"));
  }
  let changes = 0;
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
      sqlite.exec("BEGIN");
      for (const { query, values } of statements as unknown as Statement[]) {
        changes += Number(sqlite.prepare(query).run(...(values as (string | number | null)[])).changes);
      }
      sqlite.exec("COMMIT");
      return [];
    },
  };
  return {
    db,
    all: (query: string) => sqlite.prepare(query).all(),
    changes: () => changes,
  };
}

const T0 = Date.UTC(2026, 8, 28, 3, 0, 0);

function workout(id: string, overrides: Partial<ReportedWorkout> = {}): ReportedWorkout {
  return {
    id,
    activityType: "Fencing",
    startedAt: T0 - 3_600_000,
    endedAt: T0 - 600_000,
    secondsFromGMT: 28_800,
    durationSeconds: 2_900,
    distanceMeters: null,
    activeEnergyKcal: 410,
    averageHeartRateBpm: 131,
    maximumHeartRateBpm: 172,
    elevationAscendedMeters: null,
    indoor: true,
    ...overrides,
  };
}

function server(observedAt: number, overrides: Partial<ServerStatus> = {}): ServerStatus {
  return {
    id: "misaka-jp",
    hostname: "misaka-jp",
    publicIp: "203.0.113.7",
    country: "Japan",
    city: "Tokyo",
    isp: null,
    asn: null,
    asnOrg: null,
    os: "Debian",
    kernel: "6.1",
    cpuCores: 2,
    cpuUsagePercent: 10,
    load1: 0.5,
    load5: 0.4,
    load15: 0.3,
    memoryTotalBytes: 2_000,
    memoryUsedBytes: 1_000,
    memoryAvailableBytes: 1_000,
    diskTotalBytes: 10_000,
    diskUsedBytes: 5_000,
    networkInterface: "eth0",
    networkRxBytes: 1,
    networkTxBytes: 1,
    networkRxBytesPerSec: 100,
    networkTxBytesPerSec: 50,
    traffic: { cycleStart: T0 - 86_400_000, cycleEnd: T0 + 86_400_000, rxBytes: 1_000, txBytes: 500, quotaBytes: null },
    uptimeSeconds: 3_600,
    observedAt,
    ...overrides,
  };
}

test("ingest archive: workouts upsert by id and a resend of unchanged rows keeps the newest copy", async () => {
  const world = historyDb();
  const send = (items: ReportedWorkout[], pushedAt: number) =>
    archiveIngest(world.db, { source: "iphone", receivedAt: pushedAt, ignored: [], workouts: { items, pushedAt } } as PreparedIngest);

  await send([workout("a"), workout("b")], T0);
  await send([workout("a", { averageHeartRateBpm: 140 }), workout("b")], T0 + 60_000);
  await send([workout("a")], T0 + 30_000);

  assert.deepEqual(
    world.all("SELECT id, avg_hr_bpm, indoor, received_at FROM workouts ORDER BY id").map((row) => ({ ...row })),
    [
      { id: "a", avg_hr_bpm: 140, indoor: 1, received_at: T0 + 60_000 },
      { id: "b", avg_hr_bpm: 131, indoor: 1, received_at: T0 + 60_000 },
    ],
  );
});

test("ingest archive: the latest ring reading of a local day wins and history-only reports skip the table", async () => {
  const world = historyDb();
  const rings = (moveKcal: number) => ({
    date: "2026-09-28",
    secondsFromGMT: 28_800,
    moveKcal,
    moveGoalKcal: 500,
    exerciseMinutes: 20,
    exerciseGoalMinutes: 30,
    standHours: 8,
    standGoalHours: 12,
    steps: 7_000,
    distanceMeters: 5_000,
    flightsClimbed: 3,
  });
  const send = (moveKcal: number | null, receivedAt: number) => archiveIngest(world.db, {
    source: "iphone",
    receivedAt,
    ignored: [],
    activity: {
      current: moveKcal == null ? null : { activity: rings(moveKcal), receivedAt },
      history: { from: T0 - 300_000, to: T0, buckets: [] },
    },
  } as PreparedIngest);

  await send(300, T0);
  await send(420, T0 + 3_600_000);
  await send(350, T0 + 1_800_000);
  await send(null, T0 + 7_200_000);

  assert.deepEqual(
    world.all("SELECT date, move_kcal, received_at FROM activity_days").map((row) => ({ ...row })),
    [{ date: "2026-09-28", move_kcal: 420, received_at: T0 + 3_600_000 }],
  );
});

test("ingest archive: limit snapshots keep the last reading per site day and skip failed rows", async () => {
  const world = historyDb();
  const send = (usedPercent: number, receivedAt: number) => archiveIngest(world.db, {
    source: "agents",
    receivedAt,
    limits: {
      collectedAt: new Date(receivedAt).toISOString(),
      agents: [
        {
          id: "codex",
          plan: { tier: "pro", label: "Pro" },
          limits: [{ key: "codex.primary", label: null, group: "session", windowMinutes: 300, usedPercent, resetsAt: 1_790_000_000 }],
          limitsError: null,
        },
        { id: "claude", plan: null, limits: [], limitsError: "Unavailable" },
      ],
    },
  } as PreparedIngest);

  await send(10, T0);
  await send(25, T0 + 600_000);
  await send(40, T0 + 86_400_000);

  assert.deepEqual(
    world.all("SELECT date, agent, used_percent, plan FROM limit_snapshots ORDER BY date").map((row) => ({ ...row })),
    [
      { date: siteDay(T0), agent: "codex", used_percent: 25, plan: "pro" },
      { date: siteDay(T0 + 86_400_000), agent: "codex", used_percent: 40, plan: "pro" },
    ],
  );
});

test("ingest archive: server readings aggregate per UTC hour; retries and late older readings are not added", async () => {
  const world = historyDb();
  const send = (status: ServerStatus) =>
    archiveIngest(world.db, { source: "server", receivedAt: status.observedAt + 500, status } as PreparedIngest);

  await send(server(T0 + 60_000, { cpuUsagePercent: 10, load1: 1 }));
  await send(server(T0 + 180_000, { cpuUsagePercent: 30, load1: 3, traffic: { cycleStart: T0 - 86_400_000, cycleEnd: T0 + 86_400_000, rxBytes: 3_000, txBytes: 900, quotaBytes: null } }));
  await send(server(T0 + 180_000, { cpuUsagePercent: 30, load1: 3 }));
  await send(server(T0 + 120_000, { cpuUsagePercent: 20, load1: 2 }));
  await send(server(T0 + 3_600_000, { cpuUsagePercent: 50 }));

  const rows = world.all(`SELECT hour_at, samples, cpu_percent_sum, cpu_percent_max, load1_max, traffic_rx_bytes,
    last_observed_at FROM server_hours ORDER BY hour_at`).map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { hour_at: T0, samples: 2, cpu_percent_sum: 40, cpu_percent_max: 30, load1_max: 3, traffic_rx_bytes: 3_000, last_observed_at: T0 + 180_000 },
    { hour_at: T0 + 3_600_000, samples: 1, cpu_percent_sum: 50, cpu_percent_max: 50, load1_max: 0.5, traffic_rx_bytes: 1_000, last_observed_at: T0 + 3_600_000 },
  ]);
});

test("ingest archive: replaying an older server reading after a newer one (A, B, A) does not add it again", async () => {
  const world = historyDb();
  const send = (status: ServerStatus) =>
    archiveIngest(world.db, { source: "server", receivedAt: status.observedAt + 500, status } as PreparedIngest);
  const a = server(T0 + 60_000, { cpuUsagePercent: 10, load1: 1 });
  const b = server(T0 + 120_000, { cpuUsagePercent: 30, load1: 3 });

  await send(a);
  await send(b);
  await send(a);

  const rows = world.all("SELECT samples, cpu_percent_sum, load1_sum, last_observed_at FROM server_hours").map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ samples: 2, cpu_percent_sum: 40, load1_sum: 4, last_observed_at: T0 + 120_000 }]);
});

test("ingest archive: sources without long-term facts do not touch D1", async () => {
  const world = historyDb();
  await archiveIngest(world.db, { source: "homepod", receivedAt: T0 } as unknown as PreparedIngest);
  assert.equal(world.changes(), 0);
});
