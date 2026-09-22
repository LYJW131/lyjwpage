import { askStorage, tellStorage } from "@/lib/storage";
import {
  JOURNAL_LIMIT,
  JOURNAL_TTL_MS,
  journalKey,
  parseJournalEntry,
  planJournalEntry,
  type JournalSubject,
} from "@shared/state-journal";

/**
 * 追加一条展示状态。
 *
 * 和快照写在同一次上报里：这里失败就让整封失败，上报器重试。比较的是存档
 * 自己的末行，不是快照 —— 快照已经落地、存档没写上时，重试仍能把那一笔补上。
 * 没变化直接返回，心跳不会变成一条新记录。
 */
export async function recordStateChange(subject: JournalSubject, at: number, state: unknown): Promise<void> {
  const k = journalKey(subject);
  const answered = await askStorage((storage) => storage.listRange(k, -1, -1));
  if (!answered.reachable) throw new Error("状态存档读不到上一笔");
  const last = answered.value[0] ? parseJournalEntry(answered.value[0]) : null;
  const entry = planJournalEntry(last, at, state);
  if (!entry) return;
  const persisted = await tellStorage((storage) => storage.batch()
    .append(k, JSON.stringify(entry))
    .trim(k, -JOURNAL_LIMIT, -1)
    .expire(k, JOURNAL_TTL_MS)
    .execute());
  if (!persisted) throw new Error("状态存档没有写入");
}
