import assert from "node:assert/strict";
import test from "node:test";

import type { GodChatMessage } from "@shared/god-chat";
import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";
import { BUILD_DESIGN_LIMITS, PLAN_LABELS } from "@shared/build-routine";
import { readPlan } from "./build/plan.ts";
import { sealedHistory } from "./chat/seal.ts";
import { DESIGN_BUDGET_CENTS, PLANNER_PROMPT } from "./chat/design.ts";
import { agent, chatRequest, designEnv, designToken, handleChat, modelStream, parseEvents, plan, textOf, toolIO, unexpected } from "./chat/testing/handler-fixture.ts";

test("改站请求由 think 判断，start_design 只建会话发令牌、不上传访客内容；同意后补发带出开场回合，计划挂起等访客，进历史签章", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, created, sent, counters } = designEnv({
    reply: (body, index) => modelStream(body.model, index === 0 ? { name: "start_design", input: {} } : false),
    turns: [[
      agent.running,
      agent.tool("tu_clone", "bash", { command: "git clone --depth 1 https://github.com/LYJW131/lyjwpage.git /workspace/lyjwpage" }),
      agent.tool("tu_read", "read", { file_path: "/workspace/lyjwpage/src/components/live/music-card.tsx" }),
      agent.tool("tu_grep", "grep", { pattern: "empty state" }),
      ...agent.say("sevt_m1", "Here is my plan."),
      agent.custom("ctu_plan", "propose_build", plan),
      agent.waiting("ctu_plan"),
    ]],
  });
  const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
  assert.deepEqual(requests.map((body) => body.model), [GOD_CHAT_TIER_INFO.think.model]);
  assert.equal(created.length, 1);
  const session = created[0] as { agent: { type: string; id: string; system: string; model: { id: string }; tools: { type: string; name?: string; configs?: { name: string; enabled?: boolean }[] }[] }; environment_id: string; budget: { max_list_cost: { amount: string } } };
  assert.equal(session.agent.type, "agent_with_overrides");
  assert.equal(session.agent.id, "agent_test");
  assert.equal(session.agent.system, PLANNER_PROMPT);
  assert.equal(session.agent.model.id, GOD_CHAT_TIER_INFO.opus.model);
  assert.deepEqual(session.agent.tools.map((tool) => tool.name ?? tool.type), ["agent_toolset_20260401", "ask_visitor", "propose_build", "get_site_status"]);
  assert.deepEqual(session.agent.tools[0].configs?.filter((config) => config.enabled === false).map((config) => config.name), ["write", "edit"]);
  assert.equal(session.environment_id, "env_test");
  assert.equal(session.budget.max_list_cost.amount, String(DESIGN_BUDGET_CENTS));
  // 同意前：建了会话但一条访客内容都没发给 Managed Agents。
  assert.equal(sent.length, 0);
  assert.deepEqual(events.filter((event) => event.type === "route").map((event) => event.type === "route" && event.tier), ["think"]);
  const design = events.find((event) => event.type === "design");
  assert.ok(design?.type === "design");
  assert.equal(design.remaining, BUILD_DESIGN_LIMITS.maxTurns - 1);
  assert.equal(textOf(events), PLAN_LABELS.en.handoff);
  assert.ok(events.findIndex((event) => event.type === "text") < events.findIndex((event) => event.type === "design"), "the ordinary chat says one line before the planner takes over");
  assert.ok(!events.some((event) => event.type === "plan" || event.type === "doc" || event.type === "step" || event.type === "ask"));
  const firstSeal = events.find((event) => event.type === "seal");
  assert.ok(firstSeal?.type === "seal" && !firstSeal.planToken && firstSeal.trace?.tier === "think" && !firstSeal.trace?.design);
  assert.deepEqual(counters, { visitor: 1, tier: 1, clef: 1, created: 1, admitted: 1, streams: 0, peeked: 0 });

  // 同意后的补发：空会话补开场回合，整段历史此刻才进 Managed Agents。
  const opened = await parseEvents(await handleChat(chatRequest(design.token, [{ role: "user", content: "Please improve the music card." }], true), env, toolIO));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "user.message");
  assert.match(JSON.stringify(sent[0]), /Please improve the music card\./);
  assert.deepEqual(opened.filter((event) => event.type === "route").map((event) => event.type === "route" && event.tier), ["opus"]);
  assert.ok(opened.some((event) => event.type === "design" && event.remaining === BUILD_DESIGN_LIMITS.maxTurns - 1));
  assert.deepEqual(opened.filter((event) => event.type === "step").map((event) => event.type === "step" && event.text), ["Cloned the repository", "Searched the code for “empty state”"]);
  assert.ok(opened.some((event) => event.type === "doc" && event.doc === "repo" && event.path === "src/components/live/music-card.tsx" && event.url.endsWith("/blob/main/src/components/live/music-card.tsx")));
  assert.equal(textOf(opened), "Here is my plan.");
  const proposed = opened.find((event) => event.type === "plan");
  assert.ok(proposed?.type === "plan");
  assert.deepEqual((await readPlan(env, proposed.token))?.plan, plan);
  const seal = opened.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal");
  assert.equal(seal.planToken, proposed.token);
  assert.deepEqual({ tier: seal.trace?.tier, design: seal.trace?.design, plan: seal.trace?.plan }, { tier: "opus", design: true, plan: true });
  assert.deepEqual(counters, { visitor: 1, tier: 1, clef: 1, created: 1, admitted: 1, streams: 1, peeked: 1 });
  const history: GodChatMessage[] = [
    { role: "user", content: "Please improve the music card." },
    { role: "assistant", content: textOf(events), seal: firstSeal.seal, trace: firstSeal.trace },
    { role: "assistant", content: textOf(opened), seal: seal.seal, trace: seal.trace, planToken: seal.planToken },
    { role: "user", content: "Make the empty label shorter." },
  ];
  assert.equal((await sealedHistory(history, env.CHAT_HISTORY_SECRET!)).length, 4);
  assert.equal((await sealedHistory([history[0], history[1], { ...history[2], planToken: `${proposed.token}x` }, history[3]], env.CHAT_HISTORY_SECRET!)).length, 3);

  const next = designEnv({ pending: ["ctu_plan"], turns: [[agent.running, ...agent.say("sevt_m2", "Shortened."), agent.idle({ type: "end_turn" })]] });
  const token = await designToken(next.env, next.sessions);
  const answered = await parseEvents(await handleChat(chatRequest(token, history), next.env, toolIO));
  assert.deepEqual(next.sent, [{ type: "user.custom_tool_result", custom_tool_use_id: "ctu_plan", content: [{ type: "text", text: "The visitor replied:\nMake the empty label shorter." }], is_error: false }]);
  assert.equal(textOf(answered), "Shortened.");
  assert.deepEqual(next.requests, []);
  assert.deepEqual(next.counters, { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 1, streams: 1, peeked: 0 });
  const sealed = answered.find((event) => event.type === "seal");
  assert.ok(sealed?.type === "seal" && sealed.trace?.design && !sealed.planToken);
});

test("同意后两个标签页同时补发：开场只发一次，抢不到开场的那页等开场落进会话后跟着看同一回合", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const turn = [agent.running, ...agent.say("sevt_m1", "Here is my plan."), agent.custom("ctu_plan", "propose_build", plan), agent.waiting("ctu_plan")];
  const { env, sent, sessions } = designEnv({ turns: [turn, turn] });
  const token = await designToken(env, sessions);
  const messages: GodChatMessage[] = [{ role: "user", content: "Please improve the music card." }];
  const replies = await Promise.all([1, 2].map(async () => parseEvents(await handleChat(chatRequest(token, messages, true), env, toolIO))));
  assert.equal(sent.filter((event) => event.type === "user.message").length, 1);
  for (const events of replies) {
    assert.equal(textOf(events), "Here is my plan.");
    assert.ok(events.some((event) => event.type === "plan"));
    assert.ok(events.some((event) => event.type === "seal"));
  }
});

test("会话没有挂起的工具调用时，访客的话按普通消息发给规划者", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const { env, sent, sessions } = designEnv({ turns: [[agent.running, ...agent.say("sevt_m", "Sure."), agent.idle({ type: "end_turn" })]] });
  await parseEvents(await handleChat(chatRequest(await designToken(env, sessions)), env, toolIO));
  assert.deepEqual(sent, [{ type: "user.message", content: [{ type: "text", text: "Please improve the music card." }] }]);
});

test("规划者没写字就出计划时，开场白跟访客看得到的中文标题走，不跟英文规格；写了字就不再补", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const zhPlan = { ...plan, title: "回答完问题后自动折叠问题框" };
  const silent = designEnv({ turns: [[agent.running, agent.custom("ctu_plan", "propose_build", zhPlan), agent.waiting("ctu_plan")]] });
  const quiet = await parseEvents(await handleChat(chatRequest(await designToken(silent.env, silent.sessions)), silent.env, toolIO));
  assert.equal(textOf(quiet), PLAN_LABELS.zh.planReady);
  const spoken = designEnv({ turns: [[agent.running, ...agent.say("sevt_m", "改完后回答过的问题会收起来。"), agent.custom("ctu_plan", "propose_build", zhPlan), agent.waiting("ctu_plan")]] });
  const said = await parseEvents(await handleChat(chatRequest(await designToken(spoken.env, spoken.sessions)), spoken.env, toolIO));
  assert.equal(textOf(said), "改完后回答过的问题会收起来。");
});

test("规划者的自定义工具：站点状态当场回结果，不合规的题目与禁区计划报错让它重试，合规的题目挂起等访客；要确认的内置工具一律拒绝", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const questions = [{ header: "内容", question: "卡片显示多少内容？", multiSelect: false, options: [{ label: "只显示概况", description: "最简单" }, { label: "概况加展柜", description: "要维护对照表" }] }];
  const bad = [{ ...questions[0], options: [questions[0].options[0]] }];
  const { env, sent, sessions } = designEnv({ turns: [[
    agent.running,
    agent.tool("tu_curl", "bash", { command: "curl https://example.com" }, "ask"),
    agent.custom("ctu_status", "get_site_status", { views: ["timezone"] }),
    agent.custom("ctu_plan", "propose_build", { ...plan, paths: [".github/workflows/push.yml"] }),
    agent.custom("ctu_bad", "ask_visitor", { questions: bad }),
    agent.waiting("ctu_status", "ctu_plan", "ctu_bad"),
    agent.running,
    agent.custom("ctu_ask", "ask_visitor", { questions }),
    agent.waiting("ctu_ask"),
  ]] });
  const events = await parseEvents(await handleChat(chatRequest(await designToken(env, sessions)), env, toolIO));
  const replies = sent.slice(1);
  assert.deepEqual(replies.map((event) => [event.type, event.tool_use_id ?? event.custom_tool_use_id, event.result ?? event.is_error]), [
    ["user.tool_confirmation", "tu_curl", "deny"],
    ["user.custom_tool_result", "ctu_status", false],
    ["user.custom_tool_result", "ctu_plan", true],
    ["user.custom_tool_result", "ctu_bad", true],
  ]);
  assert.match(JSON.stringify(replies[1]), /Asia\/Singapore/);
  assert.ok(events.some((event) => event.type === "tool" && event.views.includes("timezone")));
  assert.deepEqual(events.filter((event) => event.type === "ask"), [{ type: "ask", questions }]);
  assert.ok(!events.some((event) => event.type === "plan"));
  assert.equal(textOf(events), "请在下面选一下。");
  const seal = events.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal" && seal.trace?.views?.includes("timezone"));
});
