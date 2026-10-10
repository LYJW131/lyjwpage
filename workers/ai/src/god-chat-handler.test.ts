import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { GOD_CHAT_LIMITS, GOD_CHAT_TURNSTILE_ACTION, type GodChatEvent, type GodChatMessage } from "@shared/god-chat";
import { GOD_CHAT_TIERS, GOD_CHAT_TIER_INFO, type GodChatEffort } from "@shared/god-chat-tiers";
import { BUILD_DESIGN_LIMITS, type BuildPlan } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import type { ChatQuota } from "./chat/quota.ts";
import type { AnthropicEgress } from "./chat/egress.ts";
import type { BuildCoordinator } from "./build/coordinator.ts";
import { signBuildToken } from "./build/token.ts";
import { readPlan } from "./build/plan.ts";
import { sealedHistory } from "./chat/seal.ts";
import { DESIGN_BUDGET_CENTS, PLANNER_PROMPT } from "./chat/design.ts";

// Node 不提供 cloudflare:workers；这里只替换基类，SDK 与流式序列化使用真实实现。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return { url: "data:text/javascript,export class DurableObject{}", shortCircuit: true };
  },
});
const { handleChat } = await import("./chat/handler.ts");

type TestStub<T> = Partial<{ [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<Awaited<R>> : T[K] }>;

function binding<T extends Rpc.DurableObjectBranded>(stub: TestStub<T>): DurableObjectNamespace<T> {
  const id: DurableObjectId = { toString: () => "test", equals: () => true };
  return {
    newUniqueId: () => id,
    idFromName: () => id,
    idFromString: () => id,
    get: () => stub as DurableObjectStub<T>,
    getByName: () => stub as DurableObjectStub<T>,
    jurisdiction: () => { throw new Error("Unexpected jurisdiction call"); },
  };
}

function modelStream(model: string, tool: boolean | { name: string; input: unknown }): Response {
  const call = typeof tool === "object" ? tool : { name: "get_site_status", input: { views: ["timezone"] } };
  const events = [
    { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: tool
      ? { type: "tool_use", id: "tool_test", name: call.name, input: {} }
      : { type: "text", text: "", citations: [] } },
    { type: "content_block_delta", index: 0, delta: tool
      ? { type: "input_json_delta", partial_json: JSON.stringify(call.input) }
      : { type: "text_delta", text: "Done." } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("三个模型的 SDK 请求都启用消息级 effort，工具续跑继承强度并在签名 trace 中记录", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => {
    globalThis.fetch = original;
  });
  for (const tier of GOD_CHAT_TIERS) {
    await t.test(tier, async () => {
      const requests: { body: Anthropic.Beta.MessageCreateParamsStreaming; headers: Headers }[] = [];
      const effort: GodChatEffort = tier === "haiku" ? "medium" : GOD_CHAT_TIER_INFO[tier].effort;
      const env: Env = {
        PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
        AI_DEV: "true",
        CHAT_FORCE_TIER: tier === "haiku" ? "haiku-medium" : tier,
        ANTHROPIC_API_KEY: "test-key",
        TURNSTILE_SECRET_KEY: "test-key",
        CHAT_HISTORY_SECRET: "test-seal",
        ALLOWED_ORIGINS: "https://lyjw.me",
        CHAT_QUOTA: binding<ChatQuota>({
          admitVisitor: async () => "ok" as const,
          admitTier: () => {
            if (tier === "haiku") return Promise.resolve("haiku" as const);
            if (tier === "sonnet") return Promise.resolve("sonnet" as const);
            return Promise.resolve("fable" as const);
          },
        }),
        ANTHROPIC_EGRESS: binding<AnthropicEgress>({
          fetch: async (request: Request) => {
            const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
            requests.push({ body, headers: request.headers });
            return modelStream(body.model, requests.length === 1);
          },
        }),
      };
      const response = await handleChat(new Request("https://api.test/api/chat", {
        method: "POST", body: JSON.stringify({ turnstileToken: "test-token", messages: [{ role: "user", content: "What's the timezone?" }] }),
      }), env, {
        readStatus: async () => Response.json({ ok: true, data: { timezone: "Asia/Singapore" } }),
        readDoc: async () => new Response("unused"),
      });
      const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent);
      assert.equal(requests.length, 2);
      for (const { body, headers } of requests) {
        assert.equal(body.model, GOD_CHAT_TIER_INFO[tier].model);
        assert.ok(body.tools?.every((tool) => !("name" in tool) || !["draft_github_issue", "start_design", "propose_build"].includes(tool.name)));
        assert.equal(body.output_config, undefined);
        assert.deepEqual(body.mcp_servers, [{ type: "url", name: "aihot", url: "https://aihot.news/api/mcp" }]);
        assert.ok(body.tools?.some((tool) => "type" in tool && tool.type === "mcp_toolset" && tool.mcp_server_name === "aihot" && tool.default_config?.enabled === false));
        assert.ok(headers.get("anthropic-beta")?.includes("mcp-client-2025-11-20"));
        assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
        assert.ok(headers.get("anthropic-beta")?.includes("mid-conversation-output-config-2026-07-01"));
        assert.equal(headers.get("anthropic-beta")?.includes("server-side-fallback-2026-07-01"), tier !== "haiku");
        assert.deepEqual(body.messages.filter((m) => m.role === "system"), [{ role: "system", content: [], output_config: { effort } }]);
      }
      assert.deepEqual(requests[1].body.messages.slice(0, requests[0].body.messages.length), requests[0].body.messages);
      assert.ok(events.some((e) => e.type === "text" && e.text === "Done."));
      const seal = events.find((e) => e.type === "seal");
      assert.ok(seal?.type === "seal");
      assert.equal(seal.trace?.effort, effort);
    });
  }
});

test("关闭限流和强制模型只有显式 AI 开发或预览开关才生效", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });

  for (const flags of [{}, { AI_DEV: "false", PREVIEW_WORKER: "false" }, { AI_DEV: "true" }, { PREVIEW_WORKER: "true" }]) {
    const dev = flags.AI_DEV === "true" || flags.PREVIEW_WORKER === "true";
    const enforced: boolean[] = [];
    const tiers: string[] = [];
    const response = await handleChat(new Request("https://ai.test/api/chat", {
      method: "POST", body: JSON.stringify({ turnstileToken: "test-token", messages: [{ role: "user", content: "hello" }] }),
    }), {
      ...flags,
      PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
      ANTHROPIC_API_KEY: "test-key",
      TURNSTILE_SECRET_KEY: "test-key",
      CHAT_HISTORY_SECRET: "test-seal",
      ALLOWED_ORIGINS: "https://lyjw.me",
      CHAT_RATE_LIMIT: "off",
      CHAT_FORCE_TIER: "fable",
      CHAT_QUOTA: binding<ChatQuota>({
        admitVisitor: async (_ip, enforce) => { enforced.push(enforce ?? true); return "ok" as const; },
        admitTier: async (_ip, tier) => { tiers.push(tier); return null; },
      }),
    }, {
      readStatus: async () => new Response("unused"),
      readDoc: async () => new Response("unused"),
    });
    assert.equal(response.status, 429);
    await response.text();
    assert.deepEqual(enforced, [!dev]);
    assert.deepEqual(tiers, dev ? ["fable"] : ["haiku"]);
  }
});

const plan: BuildPlan = {
  title: "Improve the music card empty state",
  spec: "Show an English empty-state label when no music is playing, including at mobile widths.",
  acceptance: ["At 375px the card fits its container."],
  paths: ["src/components/live/music-card.tsx"],
};

type Scripted = Record<string, unknown>;
const at = new Date(0).toISOString();
const agent = {
  running: { type: "session.status_running", id: "sevt_run", processed_at: at },
  say: (id: string, text: string): Scripted[] => [
    { type: "event_start", event: { type: "agent.message", id } },
    { type: "event_delta", event_id: id, delta: { type: "content_delta", index: 0, content: { type: "text", text: text.slice(0, 3) } } },
    { type: "agent.message", id, content: [{ type: "text", text }], processed_at: at },
  ],
  tool: (id: string, name: string, input: Record<string, unknown>, permission = "allow"): Scripted => ({ type: "agent.tool_use", id, name, input, evaluated_permission: permission, processed_at: at }),
  custom: (id: string, name: string, input: unknown): Scripted => ({ type: "agent.custom_tool_use", id, name, input, processed_at: at }),
  idle: (stop_reason: Scripted): Scripted => ({ type: "session.status_idle", id: "sevt_idle", processed_at: at, stop_reason, stop_details: null }),
  waiting: (...event_ids: string[]): Scripted => agent.idle({ type: "requires_action", event_ids }),
  visitor: (id: string, text: string): Scripted => ({ type: "user.message", id, content: [{ type: "text", text }], processed_at: at }),
  result: (id: string, toolId: string, text: string): Scripted => ({ type: "user.custom_tool_result", id, custom_tool_use_id: toolId, content: [{ type: "text", text }], is_error: false, processed_at: at }),
};

const sse = (events: Scripted[]) => new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });

// 假的 Anthropic 出站：/v1/messages 给 Sonnet，/v1/sessions* 扮演 Managed Agents；每开一次事件流按顺序吐下一段脚本。
type DesignSetup = { reply?: (body: Anthropic.Beta.MessageCreateParamsStreaming, index: number) => Response; turns?: Scripted[][]; pending?: string[]; history?: Scripted[]; createFails?: boolean };
function designEnv({ reply = (body) => modelStream(body.model, false), turns = [], pending = [], history = [], createFails = false }: DesignSetup = {}) {
  const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
  const created: Record<string, unknown>[] = [];
  const sent: Scripted[] = [];
  const counters = { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 0, streams: 0, peeked: 0 };
  const sessions = new Map<string, number>();
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    TURNSTILE_SECRET_KEY: "test-key",
    CHAT_HISTORY_SECRET: "test-seal",
    BUILD_SESSION_SECRET: "test-build",
    DESIGN_AGENT_ID: "agent_test",
    DESIGN_ENVIRONMENT_ID: "env_test",
    ALLOWED_ORIGINS: "https://lyjw.me",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async () => { counters.visitor++; return "ok" as const; },
      admitTier: async (_ip, wanted, _enforce, allowDowngrade) => {
        counters.tier++;
        assert.equal(wanted, "sonnet");
        assert.equal(allowDowngrade, false);
        return "sonnet" as const;
      },
    }),
    AI: Object.assign({} as Ai, { run: async () => { counters.clef++; return { answers: { route: { choice: "design" } } }; } }),
    BUILD_COORDINATOR: binding<BuildCoordinator>({
      createDesign: async (id) => { counters.created++; sessions.set(id, 0); return true; },
      admitDesign: async (id) => {
        counters.admitted++;
        const count = sessions.get(id);
        if (count === undefined) return { status: "expired", remaining: 0 };
        if (count >= BUILD_DESIGN_LIMITS.maxTurns) return { status: "exhausted", remaining: 0 };
        sessions.set(id, count + 1);
        return { status: "ok", remaining: BUILD_DESIGN_LIMITS.maxTurns - count - 1 };
      },
      peekDesign: async (id) => {
        counters.peeked++;
        const count = sessions.get(id);
        return count === undefined ? { status: "expired", remaining: 0 } : { status: "ok", remaining: BUILD_DESIGN_LIMITS.maxTurns - count };
      },
    }),
    ANTHROPIC_EGRESS: binding<AnthropicEgress>({
      fetch: async (request: Request) => {
        const { pathname } = new URL(request.url);
        if (pathname === "/v1/messages") {
          const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
          requests.push(body);
          return reply(body, requests.length - 1);
        }
        if (pathname === "/v1/sessions" && request.method === "POST") {
          if (createFails) return Response.json({ type: "error", error: { type: "api_error", message: "down" } }, { status: 500 });
          created.push(await request.json() as Record<string, unknown>);
          return Response.json({ id: "sesn_test", type: "session", status: "idle" });
        }
        if (pathname === "/v1/sessions/sesn_test/events/stream") {
          counters.streams++;
          return sse(turns.shift() ?? []);
        }
        if (pathname === "/v1/sessions/sesn_test/events" && request.method === "POST") {
          const body = await request.json() as { events: Scripted[] };
          sent.push(...body.events);
          return Response.json({ data: body.events });
        }
        if (pathname === "/v1/sessions/sesn_test/events") {
          if (![...new URL(request.url).searchParams.keys()].some((key) => key.startsWith("types"))) return Response.json({ data: [...history].reverse(), next_page: null });
          return Response.json({ data: pending.length ? [agent.waiting(...pending)] : [], next_page: null });
        }
        if (pathname === "/v1/sessions/sesn_test") return Response.json({ id: "sesn_test", type: "session", status: "idle" });
        throw new Error(`Unexpected request ${request.method} ${pathname}`);
      },
    }),
  };
  return { env, requests, created, sent, counters, sessions };
}

function chatRequest(designToken?: string, messages: GodChatMessage[] = [{ role: "user", content: "Please improve the music card." }], resume = false) {
  return new Request("https://api.test/api/chat", { method: "POST", body: JSON.stringify({ turnstileToken: "test-token", messages, ...(designToken && { designToken }), ...(resume && { resume }) }) });
}
const toolIO = { readStatus: async () => Response.json({ ok: true, data: { timezone: "Asia/Singapore" } }), readDoc: async () => new Response("unused") };
const parseEvents = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent);
const textOf = (events: GodChatEvent[]) => events.flatMap((event) => event.type === "text" ? [event.text] : []).join("");
const designToken = async (env: Env, sessions: Map<string, number>, payload: Record<string, unknown> = {}) => {
  const id = crypto.randomUUID();
  sessions.set(id, 1);
  return signBuildToken({ kind: "design", id, expiresAt: Date.now() + BUILD_DESIGN_LIMITS.ttlMs, sessionId: "sesn_test", ...payload }, env.BUILD_SESSION_SECRET!);
};

test("改站请求由 Sonnet 判断，start_design 建 Managed Agents 会话并在同一条回复里交给规划者；计划挂起等访客，进历史签章", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
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
  assert.deepEqual(requests.map((body) => body.model), [GOD_CHAT_TIER_INFO.sonnet.model]);
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
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "user.message");
  assert.match(JSON.stringify(sent[0]), /Please improve the music card\./);
  assert.deepEqual(events.filter((event) => event.type === "route").map((event) => event.type === "route" && event.tier), ["sonnet", "opus"]);
  const design = events.find((event) => event.type === "design");
  assert.ok(design?.type === "design");
  assert.equal(design.remaining, BUILD_DESIGN_LIMITS.maxTurns - 1);
  assert.deepEqual(events.filter((event) => event.type === "step").map((event) => event.type === "step" && event.text), ["Cloned the repository", "Searched the code for “empty state”"]);
  assert.ok(events.some((event) => event.type === "doc" && event.doc === "repo" && event.path === "src/components/live/music-card.tsx" && event.url.endsWith("/blob/main/src/components/live/music-card.tsx")));
  assert.equal(textOf(events), "Here is my plan.");
  const proposed = events.find((event) => event.type === "plan");
  assert.ok(proposed?.type === "plan");
  assert.deepEqual((await readPlan(env, proposed.token))?.plan, plan);
  const seal = events.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal");
  assert.equal(seal.planToken, proposed.token);
  assert.deepEqual({ tier: seal.trace?.tier, design: seal.trace?.design, plan: seal.trace?.plan }, { tier: "opus", design: true, plan: true });
  assert.deepEqual(counters, { visitor: 1, tier: 1, clef: 1, created: 1, admitted: 1, streams: 1, peeked: 0 });
  const reply = textOf(events);
  const history: GodChatMessage[] = [
    { role: "user", content: "Please improve the music card." },
    { role: "assistant", content: reply, seal: seal.seal, trace: seal.trace, planToken: seal.planToken },
    { role: "user", content: "Make the empty label shorter." },
  ];
  assert.equal((await sealedHistory(history, env.CHAT_HISTORY_SECRET!)).length, 3);
  assert.equal((await sealedHistory([history[0], { ...history[1], planToken: `${proposed.token}x` }, history[2]], env.CHAT_HISTORY_SECRET!)).length, 1);

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

test("会话没有挂起的工具调用时，访客的话按普通消息发给规划者", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, sent, sessions } = designEnv({ turns: [[agent.running, ...agent.say("sevt_m", "Sure."), agent.idle({ type: "end_turn" })]] });
  await parseEvents(await handleChat(chatRequest(await designToken(env, sessions)), env, toolIO));
  assert.deepEqual(sent, [{ type: "user.message", content: [{ type: "text", text: "Please improve the music card." }] }]);
});

test("规划者的自定义工具：站点状态当场回结果，不合规的题目与禁区计划报错让它重试，合规的题目挂起等访客；要确认的内置工具一律拒绝", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
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

test("断线补发：会话已停在等访客时，从访客那条回答起重推错过的文字、读过的文件和题目并盖章，不发事件给会话也不扣轮数", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
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
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
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
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
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
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
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

test("Sonnet 可以不开设计会话；模型未获授工具不能偷开会话或提计划；建会话失败时 Sonnet 自己答完", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
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
  assert.equal(events.find((event) => event.type === "seal")?.type === "seal" && (events.find((event) => event.type === "seal") as { trace?: { tier?: string } }).trace?.tier, "sonnet");
});

test("有效设计会话跳过 Clef 与普通档位额度，每轮先扣专属额度，伪造、过期、缺会话、耗尽都不碰模型", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
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

test("服务端无视工具关闭继续返回调用也不能延长工具循环", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, requests } = designEnv({ reply: (body) => modelStream(body.model, true) });
  const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
  assert.equal(requests.length, GOD_CHAT_LIMITS.maxToolRounds + 1);
  assert.deepEqual(requests.at(-1)?.tools, []);
  assert.ok(requests.every((request, i) => i < requests.length - 1 || request.mcp_servers === undefined));
  assert.ok(requests.at(-1)?.messages.some((m) => m.role === "system" && typeof m.content === "string" && m.content.startsWith("No tools remain")));
  assert.ok(events.some((event) => event.type === "text" && event.text.includes("ran out of steps")));
});

function upgradeEnv(sonnetFree: boolean) {
  const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
  const admitted: { tier: string; allowDowngrade?: boolean }[] = [];
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    AI_DEV: "true",
    CHAT_FORCE_TIER: "haiku-low",
    ANTHROPIC_API_KEY: "test-key",
    TURNSTILE_SECRET_KEY: "test-key",
    CHAT_HISTORY_SECRET: "test-seal",
    ALLOWED_ORIGINS: "https://lyjw.me",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async () => "ok" as const,
      admitTier: async (_ip, wanted, _enforce, allowDowngrade) => {
        admitted.push({ tier: wanted, allowDowngrade });
        return wanted === "sonnet" && !sonnetFree ? null : wanted;
      },
    }),
    ANTHROPIC_EGRESS: binding<AnthropicEgress>({
      fetch: async (request) => {
        const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
        requests.push(body);
        return requests.length === 1 ? modelStream(body.model, { name: "request_upgrade", input: {} }) : modelStream(body.model, false);
      },
    }),
  };
  return { env, requests, admitted };
}

test("Haiku 调 request_upgrade 后整轮对话交给 Sonnet：扣 Sonnet 名额、不带 Haiku 的草稿、路由事件改成 Prophet", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, admitted } = upgradeEnv(true);
  const events = await parseEvents(await handleChat(chatRequest(undefined, [{ role: "user", content: "Prove that sqrt(2) is irrational." }]), env, toolIO));
  assert.deepEqual(admitted.map((entry) => entry.tier), ["haiku", "sonnet"]);
  assert.equal(admitted[1].allowDowngrade, false);
  assert.equal(requests.length, 2);
  assert.ok(requests[0].tools?.some((tool) => "name" in tool && tool.name === "request_upgrade"));
  assert.equal(requests[1].model, GOD_CHAT_TIER_INFO.sonnet.model);
  assert.ok(requests[1].tools?.every((tool) => !("name" in tool) || tool.name !== "request_upgrade"));
  assert.ok(requests[1].messages.every((message) => message.role !== "assistant"));
  const routes = events.filter((event) => event.type === "route");
  assert.deepEqual(routes.map((event) => event.tier), ["haiku", "sonnet"]);
  assert.ok(routes.every((event) => event.downgradedFrom === undefined));
  const seal = events.find((event) => event.type === "seal");
  assert.equal(seal?.trace?.tier, "sonnet");
});

test("Sonnet 没有空位时 request_upgrade 回错误，Haiku 自己答完", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, requests } = upgradeEnv(false);
  const events = await parseEvents(await handleChat(chatRequest(undefined, [{ role: "user", content: "Prove that sqrt(2) is irrational." }]), env, toolIO));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].model, GOD_CHAT_TIER_INFO.haiku.model);
  assert.ok(requests[1].tools?.every((tool) => !("name" in tool) || tool.name !== "request_upgrade"));
  assert.deepEqual(events.filter((event) => event.type === "route").map((event) => event.tier), ["haiku"]);
});

test("状态读取失败不盖成查过的回复：工具结果是错误，签给页面的 trace 不含这次视图", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    AI_DEV: "true",
    CHAT_FORCE_TIER: "haiku-low",
    ANTHROPIC_API_KEY: "test-key",
    TURNSTILE_SECRET_KEY: "test-key",
    CHAT_HISTORY_SECRET: "test-seal",
    ALLOWED_ORIGINS: "https://lyjw.me",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async () => "ok" as const,
      admitTier: async () => "haiku" as const,
    }),
    ANTHROPIC_EGRESS: binding<AnthropicEgress>({
      fetch: async (request) => {
        const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
        requests.push(body);
        return modelStream(body.model, requests.length === 1);
      },
    }),
  };
  const events = await parseEvents(await handleChat(chatRequest(undefined, [{ role: "user", content: "What's the timezone?" }]), env, {
    readStatus: async () => new Response("状态存储初始化中", { status: 503 }),
    readDoc: async () => new Response("unused"),
  }));
  const results = requests[1]?.messages.at(-1)?.content;
  assert.ok(Array.isArray(results));
  const failure = results.find((block) => block.type === "tool_result");
  assert.equal(failure?.type === "tool_result" && failure.is_error, true);
  assert.match(failure?.type === "tool_result" ? String(failure.content) : "", /HTTP 503/);
  assert.doesNotMatch(failure?.type === "tool_result" ? String(failure.content) : "", /状态存储初始化中/);
  assert.equal(events.some((event) => event.type === "tool"), false);
  const seal = events.find((event) => event.type === "seal");
  assert.equal(seal?.type === "seal" && seal.trace?.views, undefined);
});
