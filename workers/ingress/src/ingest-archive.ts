import {
  activityDayStatements,
  runHistory,
  serverHourStatements,
  workoutStatements,
  type HistoryDb,
  type HistoryStatement,
} from "@shared/history-ingest";
import type { PreparedIngest } from "@shared/ingest/prepare";
import type { PrivateFacts } from "@shared/ingest/private";

import { privateStatements } from "./private-archive";

export function ingestHistoryStatements(db: HistoryDb, command: PreparedIngest): HistoryStatement[] {
  switch (command.source) {
    case "iphone":
      return [
        ...(command.workouts ? workoutStatements(db, command.workouts) : []),
        ...(command.activity ? activityDayStatements(db, command.activity) : []),
      ];
    case "server":
      return serverHourStatements(db, command.status);
    default:
      return [];
  }
}

// 私有事实单独一批：一张新表写坏（如迁移还没应用）不拖累已有的归档。
export async function archiveIngest(db: HistoryDb, command: PreparedIngest, facts: PrivateFacts | null = null): Promise<void> {
  await Promise.all([
    run(db, command, "[history]", () => ingestHistoryStatements(db, command)),
    run(db, command, "[history:private]", () => privateStatements(db, command, facts)),
  ]);
}

async function run(db: HistoryDb, command: PreparedIngest, tag: string, build: () => HistoryStatement[]): Promise<void> {
  try {
    await runHistory(db, build());
  } catch (error) {
    console.error(tag, command.source, error instanceof Error ? error.message : String(error));
  }
}
