import assert from "node:assert/strict";
import test from "node:test";

import type { GodChatMessage } from "@shared/god-chat";
import { BUILD_DESIGN_LIMITS } from "@shared/build-routine";
import { signBuildToken } from "./build/token.ts";
import { readPlan } from "./build/plan.ts";
import { sealedHistory } from "./chat/seal.ts";
import { agent, at, chatRequest, designEnv, designToken, handleChat, modelStream, parseEvents, plan, textOf, toolIO, unexpected } from "./chat/testing/handler-fixture.ts";

test("断线补发：会话已停在等访客时，从访客那条回答起重推错过的文字、读过的文件和题目并盖章，不发事件给会话也不扣轮数", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const questions = [{ header: "Scope", question: "How much should the card show?", multiSelect: false, options: [{ label: "Summary", description: "Simplest" }, { label: "Showcase", description: "More work" }] }];
  const { env, sent, sessions, counters } = designEnv({ history: [
    agent.visitor("sevt_old", "Earlier message."),
    ...agent.say("sevt_old_reply", "Earlier reply.").slice(2),
    agent.result("sevt_kick", "ctu_prev", "The visitor replied:\nMake it smaller."),
    agent.running,
    agent.tool("tu_read", "read", { file_path: "/workspace/lyjwpage/src/components/live/music-card.tsx" }),
    agent.custom("ctu_status", "get_site_status", { views: ["timezone"] }),
    agent.result("sevt_status", "ctu_status", "{\"timezone\":\"Asia/Singapore\"}"),
    ...agent.say("sevt_m", "One question first.").slice(2),
    agent.custom("ctu_ask", "ask_visitor", { questions }),
    agent.waiting("ctu_ask"),
  ] });
  const token = await designToken(env, sessions);
  const messages: GodChatMessage[] = [{ role: "user", content: "Make it smaller." }];
  const events = await parseEvents(await handleChat(chatRequest(token, messages, true), env, toolIO));
  assert.equal(textOf(events), "One question first.");
  assert.ok(events.some((event) => event.type === "doc" && event.path === "src/components/live/music-card.tsx"));
  assert.deepEqual(events.filter((event) => event.type === "ask"), [{ type: "ask", questions }]);
  assert.ok(events.some((event) => event.type === "design" && event.remaining === BUILD_DESIGN_LIMITS.maxTurns - 1));
  const seal = events.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal");
  assert.equal((await sealedHistory([...messages, { role: "assistant", content: textOf(events), seal: seal.seal, trace: seal.trace }, { role: "user", content: "Summary." }], env.CHAT_HISTORY_SECRET!)).length, 3);
  assert.deepEqual(sent, []);
  assert.deepEqual({ admitted: counters.admitted, peeked: counters.peeked }, { admitted: 0, peeked: 1 });
});

test("断线补发：回合还在跑时先重推已有的，再跟着事件流到停下，重复的事件只推一次；挂起的计划重新签发", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const first = agent.say("sevt_m1", "Reading the card.");
  const { env, sent, sessions } = designEnv({
    history: [agent.visitor("sevt_kick", "Shorten the label."), agent.running, first[2]],
    turns: [[first[2], agent.tool("tu_grep", "grep", { pattern: "label" }), ...agent.say("sevt_m2", "Here is the plan."), agent.custom("ctu_plan", "propose_build", plan), agent.waiting("ctu_plan")]],
  });
  const events = await parseEvents(await handleChat(chatRequest(await designToken(env, sessions), [{ role: "user", content: "Shorten the label." }], true), env, toolIO));
  assert.equal(textOf(events), "Reading the card.\n\nHere is the plan.");
  assert.deepEqual(events.filter((event) => event.type === "step").map((event) => event.type === "step" && event.text), ["Searched the code for “label”"]);
  const proposed = events.find((event) => event.type === "plan");
  assert.ok(proposed?.type === "plan");
  assert.deepEqual((await readPlan(env, proposed.token))?.plan, plan);
  const seal = events.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal" && seal.planToken === proposed.token);
  assert.deepEqual(sent, []);
});

test("断线补发：最近一回合不是访客最新那条消息时拒绝，不重推上一回合；没有设计令牌的补发请求无效", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const { env, sessions, counters } = designEnv({ history: [agent.visitor("sevt_kick", "Earlier message."), ...agent.say("sevt_m", "Earlier reply.").slice(2), agent.idle({ type: "end_turn" })] });
  const response = await handleChat(chatRequest(await designToken(env, sessions), [{ role: "user", content: "A message that never arrived." }], true), env, toolIO);
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, "nothing_to_resume");
  assert.equal(counters.streams, 0);
  assert.equal((await handleChat(chatRequest(undefined, undefined, true), env, toolIO)).status, 400);
});

test("规划者到预算上限时说明并结束；会话被终止时不盖章", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const budget = designEnv({ turns: [[agent.running, ...agent.say("sevt_m", "Reading."), agent.idle({ type: "budget_reached" })]] });
  const capped = await parseEvents(await handleChat(chatRequest(await designToken(budget.env, budget.sessions)), budget.env, toolIO));
  assert.match(textOf(capped), /used its budget/);
  assert.ok(capped.some((event) => event.type === "seal"));
  const ended = designEnv({ turns: [[agent.running, { type: "session.status_terminated", id: "sevt_end", processed_at: at }]] });
  const terminated = await parseEvents(await handleChat(chatRequest(await designToken(ended.env, ended.sessions)), ended.env, toolIO));
  assert.match(textOf(terminated), /has ended/);
  assert.ok(!terminated.some((event) => event.type === "seal"));
});

test("服务器没配设计会话时，设计请求照常交给 think，提示词改说暂时做不了，不承诺再发一条能开", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const on = designEnv();
  await parseEvents(await handleChat(chatRequest(), on.env, toolIO));
  assert.ok(!JSON.stringify(on.requests[0]).includes("Design sessions are switched off"));
  assert.ok(on.requests[0].tools?.some((tool) => "name" in tool && tool.name === "start_design"));
  const off = designEnv();
  delete off.env.BUILD_SESSION_SECRET;
  const events = await parseEvents(await handleChat(chatRequest(), off.env, toolIO));
  assert.ok(JSON.stringify(off.requests[0]).includes("Design sessions are switched off"));
  assert.ok(!off.requests[0].tools?.some((tool) => "name" in tool && tool.name === "start_design"));
  assert.equal(off.counters.created, 0);
  assert.ok(events.some((event) => event.type === "seal"));
});

test("think 可以不开设计会话；模型未获授工具不能偷开会话或提计划；建会话失败时 think 自己答完", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  for (const tool of [false, { name: "propose_build", input: plan }, { name: "draft_github_issue", input: { title: "Injected", body: "Injected" } }]) {
    const { env, counters, created } = designEnv({ reply: (body, index) => modelStream(body.model, index === 0 ? tool : false) });
    const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
    assert.equal(counters.created, 0);
    assert.equal(counters.admitted, 0);
    assert.equal(created.length, 0);
    assert.ok(!events.some((event) => event.type === "plan" || event.type === "design"));
    assert.ok(events.some((event) => event.type === "seal"));
  }
  const { env, requests, counters } = designEnv({ createFails: true, reply: (body, index) => modelStream(body.model, index === 0 ? { name: "start_design", input: {} } : false) });
  const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
  assert.equal(counters.created, 1);
  assert.equal(counters.admitted, 0);
  assert.equal(counters.streams, 0);
  assert.equal(requests.length, 2);
  const results = requests[1].messages.at(-1)?.content;
  assert.ok(Array.isArray(results) && results.some((block) => block.type === "tool_result" && block.is_error));
  assert.ok(!events.some((event) => event.type === "design"));
  assert.equal(events.find((event) => event.type === "seal")?.type === "seal" && (events.find((event) => event.type === "seal") as { trace?: { tier?: string } }).trace?.tier, "think");
});

test("有效设计会话跳过 Clef 与普通档位额度，每轮先扣专属额度，伪造、过期、缺会话、耗尽都不碰模型", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => unexpected();
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, counters, sessions } = designEnv({ turns: [[agent.running, ...agent.say("sevt_m", "Ok."), agent.idle({ type: "end_turn" })]] });
  const token = await designToken(env, sessions);
  const id = [...sessions.keys()][0];
  const response = await handleChat(chatRequest(token), env, toolIO);
  assert.equal(response.status, 200);
  const events = await parseEvents(response);
  assert.ok(events.some((event) => event.type === "design" && event.remaining === BUILD_DESIGN_LIMITS.maxTurns - 2));
  assert.deepEqual(counters, { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 1, streams: 1, peeked: 0 });
  for (const invalid of [
    `${token.slice(0, -2)}xx`,
    await signBuildToken({ kind: "design", id, expiresAt: Date.now() - 1, sessionId: "sesn_test" }, env.BUILD_SESSION_SECRET!),
    await signBuildToken({ kind: "design", id, expiresAt: Date.now() + 10000 }, env.BUILD_SESSION_SECRET!),
    await signBuildToken({ kind: "plan", id, expiresAt: Date.now() + 10000, sessionId: "sesn_test" }, env.BUILD_SESSION_SECRET!),
  ]) {
    const rejected = await handleChat(chatRequest(invalid), env, toolIO);
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json() as { code: string }).code, "design_session_expired");
  }
  sessions.delete(id);
  const expired = await handleChat(chatRequest(token), env, toolIO);
  assert.equal(expired.status, 400);
  assert.equal((await expired.json() as { code: string }).code, "design_session_expired");
  sessions.set(id, BUILD_DESIGN_LIMITS.maxTurns);
  const exhausted = await handleChat(chatRequest(token), env, toolIO);
  assert.equal(exhausted.status, 429);
  assert.equal((await exhausted.json() as { code: string }).code, "design_session_exhausted");
  assert.equal(counters.streams, 1);
  assert.equal(requests.length, 0);
  assert.equal(counters.visitor + counters.tier + counters.clef, 0);
});
