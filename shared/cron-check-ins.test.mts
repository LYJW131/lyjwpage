import assert from "node:assert/strict";
import test from "node:test";
import * as Sentry from "@sentry/cloudflare";
import { cronCheckIns } from "@shared/cron-check-ins";

type Sent = { status: string; start: number; done?: number };

// 按 Workers 的规矩判：调用的 waitUntil 全部落定即结束，此后还在飞的请求会被运行时取消。
async function invokeRpc(round: () => Promise<void>) {
  const t0 = Date.now();
  const sent: Sent[] = [];
  const fetch = async (_url: string | URL | Request, init?: RequestInit) => {
    const record: Sent = { status: /"status":"(\w+)"/.exec(String(init?.body))?.[1] ?? "?", start: Date.now() - t0 };
    sent.push(record);
    await new Promise((resolve) => setTimeout(resolve, 40));
    record.done = Date.now() - t0;
    return new Response("{}");
  };
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => void waits.push(promise), passThroughOnException() {}, props: {} };

  class WorkerEntrypoint {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  }
  class StateCore extends WorkerEntrypoint {
    async cronRound() {
      await round();
      return { ran: true };
    }
  }
  const Instrumented = Sentry.withSentry(
    () => ({ dsn: "https://key@o1.ingest.us.sentry.io/1", environment: "production", transportOptions: { fetch } }),
    StateCore as never,
  ) as unknown as new (ctx: unknown, env: unknown) => StateCore;

  await new Instrumented(ctx, {}).cronRound();
  for (let settled = 0; settled < waits.length; ) {
    const batch = waits.slice(settled);
    settled = waits.length;
    await Promise.all(batch);
  }
  return { sent, endedAt: Date.now() - t0 };
}

test("cron check-ins reach Sentry in order before the RPC invocation ends", async () => {
  const withCheckIns = cronCheckIns(Sentry);
  const config = { schedule: { type: "crontab", value: "2,7 * * * *" } } as const;
  const { sent, endedAt } = await invokeRpc(() => withCheckIns("minute-cron", () => new Promise((resolve) => setTimeout(resolve, 60)), config));

  assert.deepEqual(sent.map((item) => item.status), ["in_progress", "ok"]);
  for (const item of sent) assert.ok(item.done !== undefined && item.done <= endedAt, `${item.status} still in flight when the invocation ended`);
  assert.ok(sent[0].done! <= sent[1].start, "in_progress must land before ok is sent");
});
