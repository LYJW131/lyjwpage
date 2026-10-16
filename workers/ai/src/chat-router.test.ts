import assert from "node:assert/strict";
import test from "node:test";

import { GOD_CHAT_PRESETS, type GodChatMessage } from "@shared/god-chat";
import { STATUS_VIEWS } from "@shared/status-views";

import { CLEF_CHOICES, isClefChoice, presetRoute, routeWithClef } from "./chat/router.ts";
import { isProjectDocKey } from "./tools/project-docs.ts";
import { WEB_CATEGORIES } from "./chat/web-search.ts";

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

test("示例问题的档位都是 Clef 的选项，预取都是对应工具的合法输入", () => {
  for (const preset of GOD_CHAT_PRESETS) {
    assert.ok(isClefChoice(preset.choice), preset.text);
    for (const call of preset.prefetch ?? []) {
      if (call.name === "get_site_status") assert.ok(call.input.views.length > 0 && call.input.views.length <= 4 && call.input.views.every((view) => Object.hasOwn(STATUS_VIEWS, view)), preset.text);
      else if (call.name === "read_project_doc") assert.ok(isProjectDocKey(call.input.doc), preset.text);
      else assert.ok(call.input.query && WEB_CATEGORIES.includes(call.input.category), preset.text);
    }
  }
});

test("只有对话第一条与示例原文一致才跳过 Clef", () => {
  const preset = GOD_CHAT_PRESETS.find((entry) => entry.prefetch?.length)!;
  assert.deepEqual(presetRoute([user(` ${preset.text} `)]), { decision: { ...CLEF_CHOICES[preset.choice as keyof typeof CLEF_CHOICES], source: "preset" }, prefetch: preset.prefetch, ...(preset.show && { show: preset.show }) });
  assert.equal(presetRoute([user(`${preset.text}顺便讲个笑话`)]), undefined);
  assert.equal(presetRoute([user("hi"), { role: "assistant", content: "hello" }, user(preset.text)]), undefined);
});
