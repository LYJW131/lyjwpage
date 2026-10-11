import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { GOD_CHAT_LIMITS, GOD_CHAT_TURNSTILE_ACTION, type GodChatEvent, type GodChatMessage, type GodChatQuestion } from "@shared/god-chat";
import { GOD_CHAT_TIERS, GOD_CHAT_TIER_INFO, type GodChatEffort } from "@shared/god-chat-tiers";
import { BUILD_DESIGN_LIMITS, PLAN_LABELS, type BuildPlan } from "@shared/build-routine";
import type { Env } from "./runtime.ts";
import type { ChatQuota } from "./chat/quota.ts";
import type { AnthropicEgress } from "./chat/egress.ts";
import type { BuildCoordinator } from "./build/coordinator.ts";
import { signBuildToken } from "./build/token.ts";
import { issuePlan, readPlan } from "./build/plan.ts";
import { sealedHistory } from "./chat/seal.ts";
import type { DesignSession, PrepareResult } from "./chat/design-session.ts";
import { admitTurn, type DesignDraft, type DesignFrame, type DesignMeta, type DesignTurn, type DesignTurnInput, type DesignTurnResult, VISITOR_REPLY_PREFIX } from "./chat/design-turns.ts";

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

// 假的设计会话对象：跟 Durable Object 一样的 RPC 形状——prepareTurn 走同一套 admitTurn 判定，
// fetch 对 prepared 的回合消费一段脚本、挂起标记由结果推出，之后的请求一律重放存下的帧。
const frame = {
  text: (text: string): DesignFrame => ({ type: "event", event: { type: "text", text } }),
  say: (text: string): DesignFrame[] => [frame.text(text)],
  doc: (path: string): DesignFrame => ({ type: "event", event: { type: "doc", doc: "repo", path, url: `https://github.com/LYJW131/lyjwpage/blob/aaa111/${path}` } }),
  step: (text: string): DesignFrame => ({ type: "event", event: { type: "step", text } }),
  tool: (views: string[]): DesignFrame => ({ type: "event", event: { type: "tool", views } }),
  ask: (questions: GodChatQuestion[]): DesignFrame => ({ type: "event", event: { type: "ask", questions } }),
  plan: (proposal: { token: string; plan: BuildPlan; expiresAt: number }): DesignFrame => ({ type: "event", event: { type: "plan", ...proposal } }),
  result: (result: DesignTurnResult): DesignFrame => ({ type: "result", result }),
};

type SessionState = { turns: number; requestIds: Set<string> };

function fakeSession(next: () => DesignFrame[] | undefined, createFails: boolean, onStream: () => void, admitted: (requestId: string) => boolean) {
  const stub = {
    meta: undefined as DesignMeta | undefined,
    turn: undefined as (DesignTurn & { draft?: DesignDraft }) | undefined,
    frames: [] as DesignFrame[],
    pending: false,
    submitted: [] as { operationId: string; text: string }[],
    drafts: [] as DesignDraft[],
    cancelled: [] as string[],
    disposed: false,
    initialize: async (designId: string, expiresAt: number) => {
      if (createFails) throw new Error("create failed");
      stub.meta = { designId, expiresAt, createdAt: Date.now() };
    },
    prepareTurn: async (requestId: string, latest: string, draft?: DesignDraft): Promise<PrepareResult> => {
      if (stub.disposed || !stub.meta) return { status: "uninitialized" };
      if (stub.meta.expiresAt <= Date.now()) return { status: "expired" };
      const book = stub.turn ? { current: stub.turn.requestId, turns: { [stub.turn.requestId]: stub.turn } } : { turns: {} };
      const outcome = admitTurn(book, requestId, latest, Date.now());
      if (outcome.status === "prepared") {
        stub.turn = { ...outcome.turn, draft };
        if (draft) stub.drafts.push(draft);
        return { status: "prepared" };
      }
      return { status: outcome.status };
    },
    matches: async (requestId: string, latest: string) => !stub.disposed && !!stub.meta && stub.meta.expiresAt > Date.now() && stub.turn?.requestId === requestId && stub.turn.latest === latest && admitted(requestId),
    fetch: async (request: Request) => {
      if (stub.disposed || !stub.meta || stub.meta.expiresAt <= Date.now()) return Response.json({ error: "expired" }, { status: 410 });
      const input = await request.json() as DesignTurnInput;
      const turn = stub.turn;
      if (!turn || turn.requestId !== input.requestId || turn.latest !== input.latest || turn.state === "cancelled" || !admitted(input.requestId)) {
        return Response.json({ error: "The interrupted reply could not be recovered.", code: "nothing_to_resume" }, { status: 409 });
      }
      onStream();
      if (turn.state === "prepared") {
        const draft = turn.draft;
        const text = !draft ? "" : draft.kind === "open" ? "[open]" : stub.pending ? `${VISITOR_REPLY_PREFIX}${draft.text}` : draft.text;
        if (draft?.kind === "reply") stub.pending = false;
        stub.submitted.push({ operationId: turn.requestId, text });
        stub.frames = next() ?? [];
        const last = stub.frames.at(-1);
        stub.turn = { ...turn, state: "finished", result: last?.type === "result" ? last.result : { complete: false, asked: false, views: [] } };
        stub.pending = Boolean(stub.turn.result?.asked || stub.turn.result?.planToken);
      }
      const body = stub.frames.map((entry) => `${JSON.stringify(entry)}\n`).join("");
      return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
    },
    cancel: async (requestId: string) => {
      if (stub.turn?.requestId === requestId && stub.turn.state !== "finished") {
        stub.turn = { ...stub.turn, state: "cancelled" };
        stub.cancelled.push(requestId);
      }
    },
    disposeSession: async () => { stub.disposed = true; },
  };
  return stub;
}
type FakeSession = ReturnType<typeof fakeSession>;

type DesignSetup = { reply?: (body: Anthropic.Beta.MessageCreateParamsStreaming, index: number) => Response; turns?: DesignFrame[][]; createFails?: boolean };
function designEnv({ reply = (body) => modelStream(body.model, false), turns = [], createFails = false }: DesignSetup = {}) {
  const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
  const counters = { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 0, streams: 0, peeked: 0 };
  const sessions = new Map<string, SessionState>();
  const stubs = new Map<string, FakeSession>();
  const scripts = [...turns];
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    TURNSTILE_SECRET_KEY: "test-key",
    CHAT_HISTORY_SECRET: "test-seal",
    BUILD_SESSION_SECRET: "test-build",
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
      createDesign: async (id) => { counters.created++; sessions.set(id, { turns: 0, requestIds: new Set() }); return true; },
      admitDesign: async (id, requestId) => {
        counters.admitted++;
        const session = sessions.get(id);
        if (!session) return { status: "expired", remaining: 0 };
        if (requestId !== undefined && session.requestIds.has(requestId)) return { status: "ok", remaining: Math.max(0, BUILD_DESIGN_LIMITS.maxTurns - session.turns) };
        if (session.turns >= BUILD_DESIGN_LIMITS.maxTurns) return { status: "exhausted", remaining: 0 };
        session.turns += 1;
        if (requestId !== undefined) session.requestIds.add(requestId);
        return { status: "ok", remaining: BUILD_DESIGN_LIMITS.maxTurns - session.turns };
      },
      peekDesign: async (id) => {
        counters.peeked++;
        const session = sessions.get(id);
        return session === undefined ? { status: "expired", remaining: 0 } : { status: "ok", remaining: Math.max(0, BUILD_DESIGN_LIMITS.maxTurns - session.turns) };
      },
    }),
    DESIGN_SESSIONS: {
      idFromName: () => ({ toString: () => "test", equals: () => true }),
      getByName: (name: string) => {
        let stub = stubs.get(name);
        if (!stub) {
          stub = fakeSession(() => scripts.shift(), createFails, () => counters.streams++, (requestId) => sessions.get(name)?.requestIds.has(requestId) === true);
          stubs.set(name, stub);
        }
        return stub;
      },
    } as unknown as DurableObjectNamespace<DesignSession>,
    ANTHROPIC_EGRESS: binding<AnthropicEgress>({
      fetch: async (request: Request) => {
        const { pathname } = new URL(request.url);
        if (pathname === "/v1/messages") {
          const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
          requests.push(body);
          return reply(body, requests.length - 1);
        }
        throw new Error(`Unexpected request ${request.method} ${pathname}`);
      },
    }),
  };
  return { env, requests, counters, sessions, stubs, scripts };
}

function chatRequest(designToken?: string, messages: GodChatMessage[] = [{ role: "user", content: "Please improve the music card." }], resume = false, cancel = false) {
  return new Request("https://api.test/api/chat", { method: "POST", body: JSON.stringify({ turnstileToken: "test-token", messages, ...(designToken && { designToken }), ...(resume && { resume: true }), ...(cancel && { cancel: true }) }) });
}
const toolIO = { readStatus: async () => Response.json({ ok: true, data: { timezone: "Asia/Singapore" } }), readDoc: async () => new Response("unused") };
const parseEvents = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent);
const textOf = (events: GodChatEvent[]) => events.flatMap((event) => event.type === "text" ? [event.text] : []).join("");
const designToken = async (env: Env, sessions: Map<string, SessionState>, { pending = false, payload = {} }: { pending?: boolean; payload?: Record<string, unknown> } = {}) => {
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + BUILD_DESIGN_LIMITS.ttlMs;
  sessions.set(id, { turns: 1, requestIds: new Set() });
  const stub = env.DESIGN_SESSIONS!.getByName(id) as unknown as FakeSession;
  await stub.initialize(id, expiresAt);
  stub.pending = pending;
  return { token: await signBuildToken({ kind: "design", id, expiresAt, sessionId: id, ...payload }, env.BUILD_SESSION_SECRET!), id, stub };
};

test("改站请求由 Sonnet 判断，start_design 建设计会话并在同一条回复里交给规划者；计划挂起等访客，进历史签章", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, counters, stubs, scripts } = designEnv({
    reply: (body, index) => modelStream(body.model, index === 0 ? { name: "start_design", input: {} } : false),
  });
  const proposal = await issuePlan(env, plan);
  scripts.push([
    frame.doc("src/components/live/music-card.tsx"),
    frame.step("Searched the code for “empty state”"),
    ...frame.say("Here is my plan."),
    frame.plan(proposal),
    frame.result({ complete: true, asked: false, planToken: proposal.token, views: [] }),
  ]);
  const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
  assert.deepEqual(requests.map((body) => body.model), [GOD_CHAT_TIER_INFO.sonnet.model]);
  const stub = [...stubs.values()][0];
  assert.ok(stub?.meta);
  assert.equal(stub.submitted.length, 1);
  assert.equal(stub.drafts[0]?.kind, "open");
  assert.match(JSON.stringify(stub.drafts[0]), /Please improve the music card\./);
  assert.deepEqual(events.filter((event) => event.type === "route").map((event) => event.type === "route" && event.tier), ["sonnet", "opus"]);
  const design = events.find((event) => event.type === "design");
  assert.ok(design?.type === "design");
  assert.equal(design.remaining, BUILD_DESIGN_LIMITS.maxTurns - 1);
  assert.deepEqual(events.filter((event) => event.type === "step").map((event) => event.type === "step" && event.text), ["Searched the code for “empty state”"]);
  assert.ok(events.some((event) => event.type === "doc" && event.doc === "repo" && event.path === "src/components/live/music-card.tsx"));
  assert.equal(textOf(events), `${PLAN_LABELS.en.handoff}Here is my plan.`);
  assert.ok(events.findIndex((event) => event.type === "text") < events.findIndex((event) => event.type === "design"), "the ordinary chat says one line before the planner takes over");
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

  const next = designEnv({ turns: [[...frame.say("Shortened."), frame.result({ complete: true, asked: false, views: [] })]] });
  const { token, stub: session } = await designToken(next.env, next.sessions, { pending: true });
  const answered = await parseEvents(await handleChat(chatRequest(token, history), next.env, toolIO));
  assert.deepEqual(session.submitted.map((entry) => entry.text), [`${VISITOR_REPLY_PREFIX}Make the empty label shorter.`]);
  assert.equal(textOf(answered), "Shortened.");
  assert.deepEqual(next.requests, []);
  assert.deepEqual(next.counters, { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 1, streams: 1, peeked: 0 });
  const sealed = answered.find((event) => event.type === "seal");
  assert.ok(sealed?.type === "seal" && sealed.trace?.design && !sealed.planToken);
});

test("会话没有挂起的交互时，访客的话原样发给规划者", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, sessions } = designEnv({ turns: [[...frame.say("Sure."), frame.result({ complete: true, asked: false, views: [] })]] });
  const { token, stub } = await designToken(env, sessions);
  await parseEvents(await handleChat(chatRequest(token), env, toolIO));
  assert.deepEqual(stub.submitted.map((entry) => entry.text), ["Please improve the music card."]);
});

test("规划者没写字就出计划时补发收场句并签章；写了字就不再补", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const zhPlan = { ...plan, title: "回答完问题后自动折叠问题框" };
  const silent = designEnv();
  const proposal = await issuePlan(silent.env, zhPlan);
  silent.scripts.push([frame.plan(proposal), frame.result({ complete: true, asked: false, planToken: proposal.token, lead: PLAN_LABELS.zh.planReady, views: [] })]);
  const quiet = await parseEvents(await handleChat(chatRequest((await designToken(silent.env, silent.sessions)).token), silent.env, toolIO));
  assert.equal(textOf(quiet), PLAN_LABELS.zh.planReady);
  assert.ok(quiet.some((event) => event.type === "seal" && event.planToken === proposal.token));
  const spoken = designEnv();
  const spokenProposal = await issuePlan(spoken.env, zhPlan);
  spoken.scripts.push([...frame.say("改完后回答过的问题会收起来。"), frame.plan(spokenProposal), frame.result({ complete: true, asked: false, planToken: spokenProposal.token, lead: PLAN_LABELS.zh.planReady, views: [] })]);
  const said = await parseEvents(await handleChat(chatRequest((await designToken(spoken.env, spoken.sessions)).token), spoken.env, toolIO));
  assert.equal(textOf(said), "改完后回答过的问题会收起来。");
});

test("设计会话透出的事件原样推给访客：状态卡片、题目与文字；结果里的挂起交互记入 trace 与签章", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const questions = [{ header: "Scope", question: "How much should the card show?", multiSelect: false, options: [{ label: "Summary", description: "Simplest" }, { label: "Showcase", description: "More work" }] }];
  const { env, sessions } = designEnv({ turns: [[
    frame.tool(["timezone"]),
    ...frame.say("One question first."),
    frame.ask(questions),
    frame.result({ complete: true, asked: true, views: ["timezone"] }),
  ]] });
  const { token, stub } = await designToken(env, sessions);
  const events = await parseEvents(await handleChat(chatRequest(token), env, toolIO));
  assert.ok(events.some((event) => event.type === "tool" && event.views.includes("timezone")));
  assert.deepEqual(events.filter((event) => event.type === "ask"), [{ type: "ask", questions }]);
  assert.equal(textOf(events), "One question first.");
  assert.equal(stub.pending, true);
  const seal = events.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal" && seal.trace?.views?.includes("timezone") && seal.trace?.design);
});

test("断线补发：已停的回合从持久记录重推文字、文件卡片和题目并盖章，不扣轮数", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const questions = [{ header: "Scope", question: "How much should the card show?", multiSelect: false, options: [{ label: "Summary", description: "Simplest" }, { label: "Showcase", description: "More work" }] }];
  const { env, sessions, counters } = designEnv({ turns: [[
    frame.doc("src/components/live/music-card.tsx"),
    ...frame.say("One question first."),
    frame.ask(questions),
    frame.result({ complete: true, asked: true, views: [] }),
  ]] });
  const { token } = await designToken(env, sessions);
  const messages: GodChatMessage[] = [{ role: "user", content: "Make it smaller." }];
  await parseEvents(await handleChat(chatRequest(token, messages), env, toolIO));
  counters.admitted = 0;
  counters.peeked = 0;
  const events = await parseEvents(await handleChat(chatRequest(token, messages, true), env, toolIO));
  assert.equal(textOf(events), "One question first.");
  assert.ok(events.some((event) => event.type === "doc" && event.path === "src/components/live/music-card.tsx"));
  assert.deepEqual(events.filter((event) => event.type === "ask"), [{ type: "ask", questions }]);
  assert.ok(events.some((event) => event.type === "design" && event.remaining === BUILD_DESIGN_LIMITS.maxTurns - 2));
  const seal = events.find((event) => event.type === "seal");
  assert.ok(seal?.type === "seal");
  assert.equal((await sealedHistory([...messages, { role: "assistant", content: textOf(events), seal: seal.seal, trace: seal.trace }, { role: "user", content: "Summary." }], env.CHAT_HISTORY_SECRET!)).length, 3);
  assert.deepEqual({ admitted: counters.admitted, peeked: counters.peeked }, { admitted: 0, peeked: 1 });
});

test("配额被拒的回合不能靠补发换得模型调用：prepareTurn 留下的草稿没有受理记录", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, requests, sessions, counters } = designEnv();
  const { token, id } = await designToken(env, sessions);
  sessions.get(id)!.turns = BUILD_DESIGN_LIMITS.maxTurns;
  const messages = [{ role: "user" as const, content: "One more change." }];
  const denied = await handleChat(chatRequest(token, messages), env, toolIO);
  assert.equal(denied.status, 429);
  const resumed = await handleChat(chatRequest(token, messages, true), env, toolIO);
  assert.equal(resumed.status, 409);
  assert.equal((await resumed.json() as { code: string }).code, "nothing_to_resume");
  assert.deepEqual({ streams: counters.streams, calls: requests.length, admitted: counters.admitted }, { streams: 0, calls: 0, admitted: 1 });
});

test("断线补发：最近一回合不是访客最新那条消息时拒绝，不重推上一回合；没有设计令牌的补发请求无效", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const { env, sessions, counters } = designEnv({ turns: [[...frame.say("Earlier reply."), frame.result({ complete: true, asked: false, views: [] })]] });
  const { token } = await designToken(env, sessions);
  await parseEvents(await handleChat(chatRequest(token), env, toolIO));
  counters.streams = 0;
  const response = await handleChat(chatRequest(token, [{ role: "user", content: "A message that never arrived." }], true), env, toolIO);
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, "nothing_to_resume");
  assert.equal(counters.streams, 0);
  assert.equal((await handleChat(chatRequest(undefined, undefined, true), env, toolIO)).status, 400);
});

test("回合结果说明预算耗尽或会话结束时照样盖章；意外中断不盖章", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  const budget = designEnv({ turns: [[
    ...frame.say("Reading."),
    ...frame.say("\n\n(This design session has used its budget. Continue in ordinary chat.)"),
    frame.result({ complete: true, asked: false, views: [] }),
  ]] });
  const capped = await parseEvents(await handleChat(chatRequest((await designToken(budget.env, budget.sessions)).token), budget.env, toolIO));
  assert.match(textOf(capped), /used its budget/);
  assert.ok(capped.some((event) => event.type === "seal"));
  const ended = designEnv({ turns: [[
    ...frame.say("\n\n[This design session has expired. Continue in ordinary chat.]"),
    frame.result({ complete: true, asked: false, views: [] }),
  ]] });
  const expired = await parseEvents(await handleChat(chatRequest((await designToken(ended.env, ended.sessions)).token), ended.env, toolIO));
  assert.match(textOf(expired), /has expired/);
  assert.ok(expired.some((event) => event.type === "seal"));
  const broken = designEnv({ turns: [[...frame.say("\n\n[The planner stopped unexpectedly. Send another message to try again.]"), frame.result({ complete: false, asked: false, views: [] })]] });
  const interrupted = await parseEvents(await handleChat(chatRequest((await designToken(broken.env, broken.sessions)).token), broken.env, toolIO));
  assert.ok(!interrupted.some((event) => event.type === "seal"));
});

test("Sonnet 可以不开设计会话；模型未获授工具不能偷开会话或提计划；建会话失败时 Sonnet 自己答完", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, hostname: "lyjw.me", action: GOD_CHAT_TURNSTILE_ACTION });
  t.after(() => { globalThis.fetch = original; });
  for (const tool of [false, { name: "propose_build", input: plan }, { name: "draft_github_issue", input: { title: "Injected", body: "Injected" } }]) {
    const { env, counters, stubs } = designEnv({ reply: (body, index) => modelStream(body.model, index === 0 ? tool : false) });
    const events = await parseEvents(await handleChat(chatRequest(), env, toolIO));
    assert.equal(counters.created, 0);
    assert.equal(counters.admitted, 0);
    assert.equal(stubs.size, 0);
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
  const { env, requests, counters, sessions } = designEnv({ turns: [[...frame.say("Ok."), frame.result({ complete: true, asked: false, views: [] })], [...frame.say("Again."), frame.result({ complete: true, asked: false, views: [] })]] });
  const { token, id } = await designToken(env, sessions);
  const response = await handleChat(chatRequest(token), env, toolIO);
  assert.equal(response.status, 200);
  const events = await parseEvents(response);
  assert.ok(events.some((event) => event.type === "design" && event.remaining === BUILD_DESIGN_LIMITS.maxTurns - 2));
  assert.deepEqual(counters, { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 1, streams: 1, peeked: 0 });
  for (const invalid of [
    `${token.slice(0, -2)}xx`,
    await signBuildToken({ kind: "design", id, expiresAt: Date.now() - 1, sessionId: id }, env.BUILD_SESSION_SECRET!),
    await signBuildToken({ kind: "design", id, expiresAt: Date.now() + 10000 }, env.BUILD_SESSION_SECRET!),
    await signBuildToken({ kind: "plan", id, expiresAt: Date.now() + 10000, sessionId: id }, env.BUILD_SESSION_SECRET!),
  ]) {
    const rejected = await handleChat(chatRequest(invalid), env, toolIO);
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json() as { code: string }).code, "design_session_expired");
  }
  sessions.delete(id);
  const expired = await handleChat(chatRequest(token), env, toolIO);
  assert.equal(expired.status, 400);
  assert.equal((await expired.json() as { code: string }).code, "design_session_expired");
  sessions.set(id, { turns: BUILD_DESIGN_LIMITS.maxTurns, requestIds: new Set() });
  const exhausted = await handleChat(chatRequest(token, [{ role: "user", content: "Another question." }]), env, toolIO);
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
