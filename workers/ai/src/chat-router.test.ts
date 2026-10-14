import assert from "node:assert/strict";
import test from "node:test";

import type { GodChatMessage } from "@shared/god-chat";

import { routeWithClef } from "./chat/router.ts";

const user = (content: string): GodChatMessage => ({ role: "user", content });

const clef = (answer: unknown, seen?: { input?: { model?: unknown; state?: { latestMessage?: string } } }) =>
  ({
    run: async (model: unknown, input: never) => {
      if (seen) seen.input = { model, state: (input as { state?: { latestMessage?: string } }).state };
      if (answer instanceof Error) throw answer;
      return answer;
    },
  }) as unknown as Ai;

test("没有 AI 绑定或 Clef 出错时兜底到 Haiku，不拦访客", async (t) => {
  assert.deepEqual(await routeWithClef(undefined, [user("hi")]), { route: "haiku", source: "fallback" });
  const warn = t.mock.method(console, "warn", () => {});
  assert.deepEqual(await routeWithClef(clef(new Error("clef down")), [user("hi")]), { route: "haiku", source: "fallback" });
  assert.equal(warn.mock.callCount(), 1);
});

test("Clef 回的不是登记过的档位时同样兜底", async () => {
  for (const answer of [
    { answers: { route: { choice: "gpt-5" } } },
    { answers: { route: { choice: "haiku" } } },
    { answers: {} },
    null,
  ]) {
    assert.deepEqual(await routeWithClef(clef(answer), [user("hi")]), { route: "haiku", source: "fallback" });
  }
});

test("登记过的选项映射出档位、强度与设计标记，来源记 clef", async () => {
  assert.deepEqual(await routeWithClef(clef({ answers: { route: { choice: "haiku-low" } } }), [user("hi")]), {
    route: "haiku", effort: "low", source: "clef",
  });
  assert.deepEqual(await routeWithClef(clef({ answers: { route: { choice: "haiku-medium" } } }), [user("hi")]), {
    route: "haiku", effort: "medium", source: "clef",
  });
  assert.deepEqual(await routeWithClef(clef({ answers: { route: { choice: "sonnet" } } }), [user("hi")]), {
    route: "sonnet", source: "clef",
  });
  assert.deepEqual(await routeWithClef(clef({ answers: { route: { choice: "design" } } }), [user("hi")]), {
    route: "sonnet", design: true, source: "clef",
  });
  assert.deepEqual(await routeWithClef(clef({ answers: { route: { choice: "fable" } } }), [user("hi")]), {
    route: "fable", source: "clef",
  });
  assert.deepEqual(await routeWithClef(clef({ answers: { route: { choice: "refuse" } } }), [user("hi")]), {
    route: "refuse", source: "clef",
  });
});

test("发给 Clef 的是 clef 模型与最新一条访客消息", async () => {
  const seen: { input?: { model?: unknown; state?: { latestMessage?: string } } } = {};
  await routeWithClef(clef({ answers: { route: { choice: "sonnet" } } }, seen), [user("早"), user("在听什么")]);
  assert.equal(seen.input?.model, "@cf/cloudflare/clef");
  assert.equal(seen.input?.state?.latestMessage, "在听什么");
});
