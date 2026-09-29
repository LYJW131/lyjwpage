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

/**
 * 一封上报的实时提交（状态核心）成功之后，把其中要长期留存的事实写进 D1。调用方把它排进
 * 后台（waitUntil），所以可能先于可滞后层的写入完成。
 *
 * 只收已经收敛过的数据（prepare 阶段的产物），所以这里不再校验。实时层的事实
 * （在听、在看、在玩、充电、coding）由状态核心在自己的时间线上归档，不在这里。
 */
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
