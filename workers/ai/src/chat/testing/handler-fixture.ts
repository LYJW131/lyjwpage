import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import type Anthropic from "@anthropic-ai/sdk";
import type { GodChatEvent, GodChatMessage } from "@shared/god-chat";
import { BUILD_DESIGN_LIMITS, type BuildPlan } from "@shared/build-routine";
import type { Env } from "../../runtime";
import type { ChatQuota } from "../quota";
import type { AnthropicEgress } from "../egress";
import type { BuildCoordinator } from "../../build/coordinator";
import { signBuildToken } from "../../build/token";

// Node 不提供 cloudflare:workers；这里只替换基类，SDK 与流式序列化使用真实实现。
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
    return { url: "data:text/javascript,export class DurableObject{}", shortCircuit: true };
  },
});
export const { handleChat } = await import("../handler.ts");
export const { issuePass } = await import("../pass.ts");
export const PASS = (await issuePass("test-seal")).pass;

export const unexpected = () => new Response("unexpected fetch", { status: 500 });

// DeepSeek 两档不经 Anthropic 出口，直接走全局 fetch；测试把发往 DeepSeek 的请求交给 handle，其余照旧。
export function deepseekFetch(handle: (request: Request) => Promise<Response>, rest: typeof fetch = async () => unexpected()): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    return new URL(request.url).hostname === "api.deepseek.com" ? handle(request) : rest(input, init);
  };
}

export type TestStub<T> = Partial<{ [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => R | Promise<Awaited<R>> : T[K] }>;

export function binding<T extends Rpc.DurableObjectBranded>(stub: TestStub<T>): DurableObjectNamespace<T> {
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

export function modelStream(model: string, tool: boolean | { name: string; input: unknown }): Response {
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

export const plan: BuildPlan = {
  title: "Improve the music card empty state",
  spec: "Show an English empty-state label when no music is playing, including at mobile widths.",
  acceptance: ["At 375px the card fits its container."],
  paths: ["src/components/live/music-card.tsx"],
};

export type Scripted = Record<string, unknown>;
export const at = new Date(0).toISOString();
export const agent = {
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

export const sse = (events: Scripted[]) => new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });

// 假的出站：DeepSeek 的 /v1/messages 给判断改站请求的 think 档，Anthropic 出口的 /v1/sessions* 扮演 Managed Agents；
// 每开一次事件流按顺序吐下一段脚本。调用方先存好原来的 globalThis.fetch 并在测试结束时还原。
export type DesignSetup = { reply?: (body: Anthropic.Beta.MessageCreateParamsStreaming, index: number) => Response; turns?: Scripted[][]; pending?: string[]; history?: Scripted[]; createFails?: boolean };
export function designEnv({ reply = (body) => modelStream(body.model, false), turns = [], pending = [], history = [], createFails = false }: DesignSetup = {}) {
  const requests: Anthropic.Beta.MessageCreateParamsStreaming[] = [];
  const created: Record<string, unknown>[] = [];
  const sent: Scripted[] = [];
  const counters = { visitor: 0, tier: 0, clef: 0, created: 0, admitted: 0, streams: 0, peeked: 0 };
  const sessions = new Map<string, number>();
  const opened = new Set<string>();
  globalThis.fetch = deepseekFetch(async (request) => {
    const body = await request.json() as Anthropic.Beta.MessageCreateParamsStreaming;
    requests.push(body);
    return reply(body, requests.length - 1);
  }, globalThis.fetch);
  const env: Env = {
    PUBLIC_STATUS: { readStatus: async () => new Response("unused") },
    ANTHROPIC_API_KEY: "test-key",
    DEEPSEEK_API_KEY: "test-deepseek",
    TURNSTILE_SECRET_KEY: "test-turnstile",
    CHAT_HISTORY_SECRET: "test-seal",
    BUILD_SESSION_SECRET: "test-build",
    DESIGN_AGENT_ID: "agent_test",
    DESIGN_ENVIRONMENT_ID: "env_test",
    ALLOWED_ORIGINS: "https://lyjw.me",
    CHAT_QUOTA: binding<ChatQuota>({
      admitVisitor: async () => { counters.visitor++; return "ok" as const; },
      admitTier: async (_ip, wanted, _enforce, allowDowngrade) => {
        counters.tier++;
        assert.equal(wanted, "think");
        assert.equal(allowDowngrade, false);
        return "think" as const;
      },
    }),
    AI: Object.assign({} as Ai, { run: async (model: string) => { if (model === "@cf/cloudflare/clef") counters.clef++; return { answers: { route: { choice: "design" } } }; } }),
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
      claimDesignOpen: async (sessionId) => !opened.has(sessionId) && Boolean(opened.add(sessionId)),
    }),
    ANTHROPIC_EGRESS: binding<AnthropicEgress>({
      colo: async () => "KIX",
      fetch: async (request: Request) => {
        const { pathname } = new URL(request.url);
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
          if (![...new URL(request.url).searchParams.keys()].some((key) => key.startsWith("types"))) return Response.json({ data: [...history, ...sent].reverse(), next_page: null });
          return Response.json({ data: pending.length ? [agent.waiting(...pending)] : [], next_page: null });
        }
        if (pathname === "/v1/sessions/sesn_test") return Response.json({ id: "sesn_test", type: "session", status: "idle" });
        throw new Error(`Unexpected request ${request.method} ${pathname}`);
      },
    }),
  };
  return { env, requests, created, sent, counters, sessions };
}

export function chatRequest(designToken?: string, messages: GodChatMessage[] = [{ role: "user", content: "Please improve the music card." }], resume = false) {
  return new Request("https://api.test/api/chat", { method: "POST", body: JSON.stringify({ humanPass: PASS, anthropic: "allow", messages, ...(designToken && { designToken }), ...(resume && { resume }) }) });
}
export const toolIO = { readStatus: async () => Response.json({ ok: true, data: { timezone: "Asia/Singapore" } }), readDoc: async () => new Response("unused") };
export const parseEvents = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as GodChatEvent);
export const textOf = (events: GodChatEvent[]) => events.flatMap((event) => event.type === "text" ? [event.text] : []).join("");
export const designToken = async (env: Env, sessions: Map<string, number>, payload: Record<string, unknown> = {}) => {
  const id = crypto.randomUUID();
  sessions.set(id, 1);
  return signBuildToken({ kind: "design", id, expiresAt: Date.now() + BUILD_DESIGN_LIMITS.ttlMs, sessionId: "sesn_test", ...payload }, env.BUILD_SESSION_SECRET ?? "");
};

export function scriptedStream(model: string, blocks: Record<string, unknown>[], stop: string): Response {
  const events: Record<string, unknown>[] = [
    { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
    ...blocks.flatMap((block, index): Record<string, unknown>[] => block.type === "text"
      ? [{ type: "content_block_start", index, content_block: { type: "text", text: "", citations: [] } }, { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } }, { type: "content_block_stop", index }]
      : [{ type: "content_block_start", index, content_block: { ...block, input: {} } }, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }, { type: "content_block_stop", index }]),
    { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}
