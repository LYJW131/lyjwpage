import assert from "node:assert/strict";
import test from "node:test";

import { GOD_CHAT_PRESETS, type GodChatMessage } from "@shared/god-chat";
import { STATUS_VIEWS } from "@shared/status-views";

import { CLEF_CHOICES, ITEM_MAX_P_NULL, ITEM_MIN_CONFIDENCE, PREFETCH_MIN_PROBABILITY, PREFETCH_STATUS, isClefChoice, parseItem, presetRoute, routeWithClef, routerInput } from "./chat/router.ts";
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

test("没有 AI 绑定或 Clef 出错时兜底到 Small Fry，不拦访客", async (t) => {
  assert.deepEqual(await routeWithClef(undefined, [user("hi")]), { route: "flash", source: "fallback" });
  const warn = t.mock.method(console, "warn", () => {});
  assert.deepEqual(await routeWithClef(clef(new Error("clef down")), [user("hi")]), { route: "flash", source: "fallback" });
  assert.equal(warn.mock.callCount(), 2);
});

test("Clef 回的不是登记过的档位时同样兜底", async () => {
  for (const answer of [
    { answers: { route: { choice: "gpt-5" } } },
    { answers: { route: { choice: "haiku-low" } } },
    { answers: { route: { choice: "sonnet" } } },
    { answers: {} },
    null,
  ]) {
    assert.deepEqual(await routeWithClef(clef(answer), [user("hi")]), { route: "flash", source: "fallback" });
  }
});

test("登记过的选项映射出档位与设计标记，来源记 clef", async () => {
  assert.deepEqual(await routeWithClef(clef({ answers: { route: { choice: "flash" } } }), [user("hi")]), {
    route: "flash", source: "clef",
  });
  assert.deepEqual(await routeWithClef(clef({ answers: { route: { choice: "think" } } }), [user("hi")]), {
    route: "think", source: "clef",
  });
  assert.deepEqual(await routeWithClef(clef({ answers: { route: { choice: "design" } } }), [user("hi")]), {
    route: "think", design: true, source: "clef",
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
  await routeWithClef(clef({ answers: { route: { choice: "think" } } }, seen), [user("早"), user("在听什么")]);
  assert.equal(seen.input?.model, "@cf/cloudflare/clef");
  assert.equal(seen.input?.state?.latestMessage, "在听什么");
});

test("示例问题的档位都是 Clef 的选项，预取都是对应工具的合法输入", () => {
  for (const preset of GOD_CHAT_PRESETS) {
    assert.ok(isClefChoice(preset.choice), preset.text);
    for (const call of preset.prefetch ?? []) {
      if (call.name === "get_site_status") assert.ok(call.input.views.length > 0 && call.input.views.length <= 4 && call.input.views.every((view) => Object.hasOwn(STATUS_VIEWS, view)), preset.text);
      else if (call.name === "read_project_doc") assert.ok(isProjectDocKey(call.input.doc), preset.text);
      else if (call.name === "web_search") assert.ok(call.input.query && WEB_CATEGORIES.includes(call.input.category), preset.text);
      else assert.fail(`${preset.text}: presets don't draw cards`);
    }
  }
});

test("只有对话第一条与示例原文一致才跳过 Clef", () => {
  const preset = GOD_CHAT_PRESETS.find((entry) => entry.prefetch?.length)!;
  assert.deepEqual(presetRoute([user(` ${preset.text} `)]), { decision: { ...CLEF_CHOICES[preset.choice as keyof typeof CLEF_CHOICES], source: "preset", prefetch: preset.prefetch }, ...(preset.show && { show: preset.show }) });
  assert.equal(presetRoute([user(`${preset.text}顺便讲个笑话`)]), undefined);
  assert.equal(presetRoute([user("hi"), { role: "assistant", content: "hello" }, user(preset.text)]), undefined);
});

const answered = (route: string, status?: [string, number], doc?: [string, number]) => ({
  answers: {
    route: { type: "choice", choice: route, confidence: 1, probabilities: { [route]: 1 } },
    ...(status && { status: { type: "choice", choice: status[0], confidence: status[1], probabilities: { [status[0]]: status[1] } } }),
    ...(doc && { doc: { type: "choice", choice: doc[0], confidence: doc[1], probabilities: { [doc[0]]: doc[1] } } }),
  },
});

test("Clef 有把握时把状态与文档的预取带进决定", async () => {
  assert.deepEqual(await routeWithClef(clef(answered("flash", ["listening", 0.9], ["overview", PREFETCH_MIN_PROBABILITY.doc])), [user("在听什么")]), {
    route: "flash", source: "clef",
    prefetch: [
      { name: "get_site_status", input: { views: [...PREFETCH_STATUS.listening.views] } },
      { name: "read_project_doc", input: { doc: "overview" } },
    ],
  });
});

const both = (clefAnswer: unknown, clairic: unknown) =>
  ({
    run: async (model: string) => {
      if (model === "@cf/cloudflare/clairic") {
        if (clairic instanceof Error) throw clairic;
        return clairic;
      }
      return clefAnswer;
    },
  }) as unknown as Ai;
const extracted = (value: string | null, pNull = 0.001, confidence = 0.98) => ({ answers: { item: { type: "text", value, guess: value ?? "x", p_null: pNull, confidence } } });

test("Clairic 抽到具体条目时，能搜的分组在整组之外带 query 再读一次，游戏组另外直接画那款游戏的卡", async () => {
  assert.deepEqual(await routeWithClef(both(answered("flash", ["playing", 0.95]), extracted("《艾尔登法环》")), [user("他最近玩艾尔登法环了吗")]), {
    route: "flash", source: "clef",
    prefetch: [
      { name: "get_site_status", input: { views: [...PREFETCH_STATUS.playing.views] } },
      { name: "get_site_status", input: { views: [...PREFETCH_STATUS.playing.query], query: "艾尔登法环" } },
      { name: "show_card", input: { card: "game", game: "艾尔登法环" } },
    ],
  });
  assert.deepEqual(await routeWithClef(both(answered("flash", ["watching", 0.95]), extracted("葬送的芙莉莲")), [user("他看葬送的芙莉莲了吗")]), {
    route: "flash", source: "clef",
    prefetch: [
      { name: "get_site_status", input: { views: [...PREFETCH_STATUS.watching.views] } },
      { name: "get_site_status", input: { views: ["watching"], query: "葬送的芙莉莲" } },
    ],
  });
  assert.deepEqual(await routeWithClef(both(answered("flash", ["limits", 0.95]), extracted("Claude")), [user("Claude 额度还剩多少")]), {
    route: "flash", source: "clef",
    prefetch: [{ name: "get_site_status", input: { views: [...PREFETCH_STATUS.limits.views] } }],
  });
});

test("Clairic 没把握、抽空或出错时照旧预取整组", async (t) => {
  const plain = { route: "flash", source: "clef", prefetch: [{ name: "get_site_status", input: { views: [...PREFETCH_STATUS.listening.views] } }] };
  for (const clairic of [extracted(null, 0.9), extracted("歌", ITEM_MAX_P_NULL + 0.01), extracted("歌", 0, ITEM_MIN_CONFIDENCE - 0.01), { answers: {} }]) {
    assert.deepEqual(await routeWithClef(both(answered("flash", ["listening", 0.95]), clairic), [user("在听什么")]), plain);
  }
  const warn = t.mock.method(console, "warn", () => {});
  assert.deepEqual(await routeWithClef(both(answered("flash", ["listening", 0.95]), new Error("clairic down")), [user("在听什么")]), plain);
  assert.equal(warn.mock.callCount(), 1);
});

test("Clef 没选可搜的状态分组时不等 Clairic", async () => {
  const hanging = { run: async (model: string) => model === "@cf/cloudflare/clairic" ? new Promise(() => {}) : answered("flash", ["none", 0.99]) } as unknown as Ai;
  assert.deepEqual(await routeWithClef(hanging, [user("你好")]), { route: "flash", source: "clef" });
});

test("选档日志只记选项、概率与有没有抽到条目，不记访客原文", async (t) => {
  const info = t.mock.method(console, "info", () => {});
  await routeWithClef(both(answered("flash", ["playing", 0.95]), extracted("月姬")), [user("他玩过月姬吗")]);
  const line = info.mock.calls.map((call) => call.arguments.join(" ")).find((text) => text.startsWith("[god-chat] route"));
  assert.ok(line?.includes('"status":"playing 0.950"') && line.includes('"item":true') && line.includes('"prefetch":3'));
  assert.ok(!line?.includes("月姬"));
  info.mock.resetCalls();
  await routeWithClef(clef({ answers: { route: { choice: "他玩过月姬吗" }, status: { choice: "他玩过月姬吗", probabilities: { "他玩过月姬吗": 1 } } } }), [user("他玩过月姬吗")]);
  const odd = info.mock.calls.map((call) => call.arguments.join(" ")).find((text) => text.startsWith("[god-chat] route"));
  assert.ok(odd?.includes('"route":"unlisted"') && odd.includes('"status":"unlisted"') && !odd.includes("月姬"));
});

test("parseItem 去掉书名号与引号", () => {
  assert.equal(parseItem(extracted("「葬送的芙莉莲」")), "葬送的芙莉莲");
  assert.equal(parseItem(extracted("\"Astro Bot\"")), "Astro Bot");
  assert.equal(parseItem(extracted("《》")), undefined);
});

test("概率不够、选了 none、选项没登记或缺答时不预取", async () => {
  for (const answer of [
    answered("think", ["listening", PREFETCH_MIN_PROBABILITY.status - 0.01], ["overview", PREFETCH_MIN_PROBABILITY.doc - 0.01]),
    answered("think", ["none", 0.99], ["none", 0.99]),
    answered("think", ["weather", 0.99], ["secrets", 0.99]),
    answered("think"),
  ]) {
    assert.deepEqual(await routeWithClef(clef(answer), [user("hi")]), { route: "think", source: "clef" });
  }
});

test("拒答与设计请求不预取", async () => {
  assert.deepEqual(await routeWithClef(clef(answered("refuse", ["now", 0.99])), [user("hi")]), { route: "refuse", source: "clef" });
  assert.deepEqual(await routeWithClef(clef(answered("design", ["commits", 0.99], ["overview", 0.99])), [user("hi")]), { route: "think", design: true, source: "clef" });
});

test("预取分组都是合法的状态视图，一组不超过一次能读的数量；文档选项都是登记过的文档", () => {
  for (const [key, entry] of Object.entries(PREFETCH_STATUS)) {
    assert.ok(entry.views.length <= 4 && entry.views.every((view) => Object.hasOwn(STATUS_VIEWS, view)), key);
    assert.equal(entry.views.length === 0, key === "none", key);
  }
  const { questions } = routerInput([user("hi")]);
  assert.ok(Object.keys(questions.doc.criteria).every((key) => key === "none" || isProjectDocKey(key)));
});
