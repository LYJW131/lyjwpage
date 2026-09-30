import {
  activityDayStatements,
  limitStatements,
  runHistory,
  serverHourStatements,
  workoutStatements,
  type HistoryDb,
  type HistoryStatement,
} from "@shared/history-ingest";
import type { PreparedIngest } from "@shared/ingest/prepare";

export function ingestHistoryStatements(db: HistoryDb, command: PreparedIngest): HistoryStatement[] {
  switch (command.source) {
    case "iphone":
      return [
        ...(command.workouts ? workoutStatements(db, command.workouts) : []),
        ...(command.activity ? activityDayStatements(db, command.activity) : []),
      ];
    case "server":
      return serverHourStatements(db, command.status);
    case "agents":
      return command.limits ? limitStatements(db, command.limits, command.receivedAt) : [];
    default:
      return [];
  }
}

export async function archiveIngest(db: HistoryDb, command: PreparedIngest): Promise<void> {
  try {
    await runHistory(db, ingestHistoryStatements(db, command));
  } catch (error) {
    console.error("[history]", command.source, error instanceof Error ? error.message : String(error));
  }
}
