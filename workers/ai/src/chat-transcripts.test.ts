import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return {
      url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}",
      shortCircuit: true,
    };
  },
});
const { ChatLog, TRANSCRIPT_RETENTION_MS } = await import("./chat/transcripts.ts");

function chatLog(db = new DatabaseSync(":memory:")) {
  let alarm: number | null = null;
  const sql = {
    exec(query: string, ...bindings: (string | number | null)[]) {
      const statement = db.prepare(query);
      const rows = /^\s*(select|pragma)/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { one: () => rows[0], toArray: () => rows };
    },
  };
  const storage = {
    sql,
    getAlarm: async () => alarm,
    setAlarm: async (at: number) => { alarm = at; },
    deleteAlarm: async () => { alarm = null; },
  };
  const log = new ChatLog({ storage } as unknown as DurableObjectState, {} as never);
  return { log, rows: () => db.prepare("SELECT * FROM transcripts ORDER BY id").all(), alarm: () => alarm };
}

const entry = {
  route: "think",
  tier: "think",
  source: "clef",
  messages: [
    { role: "user" as const, content: "hi" },
    { role: "assistant" as const, content: "hello", seal: "s".repeat(30), planToken: "a.b" },
    { role: "user" as const, content: "again" },
  ],
  reply: "answer",
  outcome: "complete" as const,
};

test("对话记录：只存角色与正文，不存签名与计划令牌，并排上到期清理", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const { log, rows, alarm } = chatLog();
  await log.record(entry);
  const [row] = rows() as { messages: string; reply: string; outcome: string; at: number }[];
  assert.deepEqual(JSON.parse(row.messages), [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }, { role: "user", content: "again" }]);
  assert.equal(row.reply, "answer");
  assert.equal(row.outcome, "complete");
  assert.equal(alarm(), 1_000 + TRANSCRIPT_RETENTION_MS);
});

test("对话记录：到期的行在 alarm 删掉，下一次 alarm 排到剩下最老一行到期", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const { log, rows, alarm } = chatLog();
  await log.record(entry);
  t.mock.timers.setTime(5_000);
  await log.record({ ...entry, reply: "later" });
  t.mock.timers.setTime(1_000 + TRANSCRIPT_RETENTION_MS);
  await log.alarm();
  assert.deepEqual(rows().map((row) => row.reply), ["later"]);
  assert.equal(alarm(), 5_000 + TRANSCRIPT_RETENTION_MS);
  t.mock.timers.setTime(5_000 + TRANSCRIPT_RETENTION_MS);
  await log.alarm();
  assert.equal(rows().length, 0);
  assert.equal(alarm(), null);
});

test("对话记录：旧表补上 scores 列，重建实例不重复加列，Clef 概率按 JSON 存", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE transcripts (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, route TEXT NOT NULL, tier TEXT, source TEXT NOT NULL, design_session TEXT, outcome TEXT NOT NULL, messages TEXT NOT NULL, reply TEXT NOT NULL, trace TEXT)");
  chatLog(db);
  const { log, rows } = chatLog(db);
  await log.record({ ...entry, scores: { status: { choice: "listening", p: 0.9 } } });
  await log.record(entry);
  assert.deepEqual(rows().map((row) => row.scores), ['{"status":{"choice":"listening","p":0.9}}', null]);
});
