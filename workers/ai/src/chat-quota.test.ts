import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { GOD_CHAT_QUOTA, GOD_CHAT_ROUTE_LIMIT, GOD_CHAT_TIERS, type GodChatTier } from "@shared/god-chat-tiers";

import { billedOutputTokens } from "./chat/billing.ts";
import type { Env } from "./runtime.ts";

// Node 不认 cloudflare:workers，这里给 DurableObject 基类换一个只存 ctx / env 的替身；hook 要先注册，ChatQuota 只能动态导入。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return {
      url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}",
      shortCircuit: true,
    };
  },
});
const { ChatQuota } = await import("./chat/quota.ts");

type Iteration = Anthropic.Beta.BetaIterationsUsage[number];
const cacheFields = { cache_creation: null, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, input_tokens: 100 };
const message = (output_tokens: number, model = "claude-fable-5-1"): Iteration => ({ ...cacheFields, type: "message", model, output_tokens });
const fallbackMessage = (output_tokens: number, model = "claude-opus-4-8"): Iteration => ({ ...cacheFields, type: "fallback_message", model, output_tokens });

test("计费输出：没有兜底时各轮加起来，与顶层一致", () => {
  assert.equal(billedOutputTokens({ output_tokens: 700, iterations: [message(300), message(400)] }), 700);
});

test("计费输出：本档开口前就被拒，只算兜底那一跳", () => {
  assert.equal(billedOutputTokens({ output_tokens: 264, iterations: [message(0), fallbackMessage(264)] }), 264);
});

test("计费输出：本档写到一半被拒，被拒那跳的输出也要扣", () => {
  assert.equal(billedOutputTokens({ output_tokens: 300, iterations: [message(500), fallbackMessage(300)] }), 800);
});

test("计费输出：没有 iterations 时用顶层", () => {
  assert.equal(billedOutputTokens({ output_tokens: 512, iterations: null }), 512);
  assert.equal(billedOutputTokens({ output_tokens: 512, iterations: [] }), 512);
});

test("计费输出：iterations 比顶层还少（快照不完整）时不少扣", () => {
  assert.equal(billedOutputTokens({ output_tokens: 900, iterations: [message(1)] }), 900);
});

function quota() {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...bindings: (string | number)[]) {
      const statement = db.prepare(query);
      if (!/^\s*select/i.test(query)) {
        statement.run(...bindings);
        return { one: () => assert.fail("one() on a write") };
      }
      const rows = statement.all(...bindings);
      return {
        one() {
          assert.equal(rows.length, 1);
          return rows[0];
        },
      };
    },
  };
  const transactionSync = <T>(fn: () => T): T => {
    db.exec("BEGIN");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const ctx = { storage: { sql, transactionSync } } as unknown as DurableObjectState;
  const hits = (key?: string) =>
    Number((key ? db.prepare("SELECT COUNT(*) AS n FROM hits WHERE key = ?").get(key) : db.prepare("SELECT COUNT(*) AS n FROM hits").get())!.n);
  return { chat: new ChatQuota(ctx, {} as Env), hits };
}

function fillTierEveryone(chat: InstanceType<typeof ChatQuota>, tier: GodChatTier) {
  for (let i = 0; i < GOD_CHAT_QUOTA.tiers[tier].everyone; i++) assert.equal(chat.admitTier(`filler-${tier}-${i}`, tier), tier);
}

test("访客总量用完回 visitor，被拒的不记账", () => {
  const { chat, hits } = quota();
  for (let i = 0; i < GOD_CHAT_QUOTA.visitor; i++) assert.equal(chat.admitVisitor("1.1.1.1"), "ok");
  const before = hits();
  assert.equal(chat.admitVisitor("1.1.1.1"), "visitor");
  assert.equal(hits(), before);
  assert.equal(chat.admitVisitor("2.2.2.2"), "ok");
});

test("全站路由次数到上限后换 IP 也回 site，不再调 Clef", () => {
  const { chat, hits } = quota();
  for (let i = 0; i < GOD_CHAT_ROUTE_LIMIT; i++) assert.equal(chat.admitVisitor(`10.0.0.${i}`), "ok");
  assert.equal(hits("r:all"), GOD_CHAT_ROUTE_LIMIT);
  const before = hits();
  assert.equal(chat.admitVisitor("10.0.1.1"), "site");
  assert.equal(hits(), before);
});

test("全站路由次数满了，面板倒计时也指向它最早一次过期", () => {
  const { chat } = quota();
  assert.equal(chat.usage("10.0.1.1").resetInMs, 0);
  for (let i = 0; i < GOD_CHAT_ROUTE_LIMIT; i++) chat.admitVisitor(`10.0.0.${i}`);
  assert.ok(chat.usage("10.0.1.1").resetInMs > 0);
});

test("三档全站都满时新访客回 site", () => {
  const { chat } = quota();
  for (const tier of GOD_CHAT_TIERS) fillTierEveryone(chat, tier);
  assert.equal(chat.admitVisitor("3.3.3.3"), "site");
});

test("只要还有一档两道都有空就放行", () => {
  const { chat } = quota();
  fillTierEveryone(chat, "fable");
  fillTierEveryone(chat, "opus");
  assert.equal(chat.admitVisitor("3.3.3.3"), "ok");
});

test("访客自己三档名额都满回 visitor，即便访客总量还有余", () => {
  const { chat } = quota();
  for (const tier of GOD_CHAT_TIERS) {
    for (let i = 0; i < GOD_CHAT_QUOTA.tiers[tier].visitor; i++) assert.equal(chat.admitTier("4.4.4.4", tier), tier);
  }
  assert.equal(chat.admitVisitor("4.4.4.4"), "visitor");
});

test("访客空着的档全站已满、其余档自己用满时回 site", () => {
  const { chat } = quota();
  for (let i = 0; i < GOD_CHAT_QUOTA.tiers.haiku.visitor; i++) assert.equal(chat.admitTier("5.5.5.5", "haiku"), "haiku");
  fillTierEveryone(chat, "opus");
  fillTierEveryone(chat, "fable");
  assert.equal(chat.admitVisitor("5.5.5.5"), "site");
});

test("enforce 为 false 时满了也放行，照样记账", () => {
  const { chat, hits } = quota();
  for (let i = 0; i < GOD_CHAT_ROUTE_LIMIT; i++) chat.admitVisitor(`10.0.0.${i}`);
  for (const tier of GOD_CHAT_TIERS) fillTierEveryone(chat, tier);
  assert.equal(chat.admitVisitor("6.6.6.6", false), "ok");
  assert.equal(hits("r:all"), GOD_CHAT_ROUTE_LIMIT + 1);
  assert.equal(hits("v:6.6.6.6"), 1);
});

test("设计候选请求需要 Opus：该档用满不占用较低档的额度", () => {
  const { chat, hits } = quota();
  for (let i = 0; i < GOD_CHAT_QUOTA.tiers.opus.visitor; i++) assert.equal(chat.admitTier("designer", "opus"), "opus");
  const before = hits();
  assert.equal(chat.admitTier("designer", "opus", true, false), null);
  assert.equal(hits(), before);
  assert.equal(hits("t:haiku:designer"), 0);
  assert.equal(chat.admitTier("designer", "opus"), "haiku");
});
