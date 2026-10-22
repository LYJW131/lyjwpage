import { DurableObject } from "cloudflare:workers";

import type { GodChatMessage, GodChatTrace } from "@shared/god-chat";

import type { Env } from "../runtime";
import type { PrefetchScores } from "./router";

// 首页对话隐私说明（src/components/god-chat/consent.tsx#CONSENT_COPY）按这个期限写，改期限要同步改三种语言。
export const TRANSCRIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type TranscriptOutcome = "complete" | "incomplete" | "failed" | "aborted" | "refused";

export type Transcript = {
  route: string;
  tier: string | null;
  source: string;
  designSession?: string;
  messages: GodChatMessage[];
  reply: string;
  trace?: GodChatTrace;
  // Clef 对状态题、文档题的首选与概率，校准 PREFETCH_MIN_PROBABILITY 用；示例问题与回落不调 Clef，没有这一项。
  scores?: PrefetchScores;
  outcome: TranscriptOutcome;
};

// 全站一个实例：每条请求记一行（发给模型的整段历史加这次回复），超过 TRANSCRIPT_RETENTION_MS 的行在写入和 alarm 时删掉，
// 没有新对话时也由 alarm 按最老一行到期的时刻清理。不存 IP 与令牌。
export class ChatLog extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, route TEXT NOT NULL, tier TEXT, source TEXT NOT NULL, design_session TEXT, outcome TEXT NOT NULL, messages TEXT NOT NULL, reply TEXT NOT NULL, trace TEXT)",
    );
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS transcripts_at ON transcripts (at)");
    const columns = ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(transcripts)").toArray();
    if (!columns.some((column) => column.name === "scores")) ctx.storage.sql.exec("ALTER TABLE transcripts ADD COLUMN scores TEXT");
  }

  private prune(now: number): void {
    this.ctx.storage.sql.exec("DELETE FROM transcripts WHERE at <= ?", now - TRANSCRIPT_RETENTION_MS);
  }

  private async scheduleNext(): Promise<void> {
    const oldest = this.ctx.storage.sql.exec<{ at: number | null }>("SELECT MIN(at) AS at FROM transcripts").one().at;
    if (oldest === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(oldest + TRANSCRIPT_RETENTION_MS);
  }

  async record(entry: Transcript): Promise<void> {
    const now = Date.now();
    const messages = entry.messages.map(({ role, content, time }) => ({ role, content, ...(time && { time }) }));
    this.ctx.storage.sql.exec(
      "INSERT INTO transcripts (at, route, tier, source, design_session, outcome, messages, reply, trace, scores) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      now, entry.route, entry.tier, entry.source, entry.designSession ?? null, entry.outcome, JSON.stringify(messages), entry.reply, entry.trace ? JSON.stringify(entry.trace) : null, entry.scores ? JSON.stringify(entry.scores) : null,
    );
    this.prune(now);
    if ((await this.ctx.storage.getAlarm()) === null) await this.scheduleNext();
  }

  async alarm(): Promise<void> {
    this.prune(Date.now());
    await this.scheduleNext();
  }
}

export async function saveTranscript(env: Env, entry: Transcript): Promise<void> {
  if (!env.CHAT_LOG) return;
  try {
    await env.CHAT_LOG.getByName("global").record(entry);
  } catch (error) {
    // 只记错误类型：消息里可能带出写入的值，对话不进 Workers Observability。
    console.warn("[god-chat] transcript not saved", error instanceof Error ? error.name : typeof error);
  }
}
