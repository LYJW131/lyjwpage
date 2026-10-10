import { DurableObject } from "cloudflare:workers";

import { STATUS_VIEWS } from "@/lib/status-views";
import { GOD_CHAT_TIER_INFO } from "@shared/god-chat-tiers";

import { BuildCoordinator } from "../src/build/coordinator";
import { issuePlan } from "../src/build/plan";
import { signBuildToken, verifyBuildToken } from "../src/build/token";
import { checkBuildPlan } from "../src/build/validation";
import { admitDesign, PLANNER_PROMPT, startDesign } from "../src/chat/design";
import { anthropicFetch } from "../src/chat/egress";
import { readJsonBody } from "../src/chat/guard";
import { aiDevEnabled, type Env as AiEnv } from "../src/runtime";
import { DESIGN_TOOL_NAMES, DESIGN_TOOLS, OPUS_PRICE, PATHS, TURN_LIMITS } from "./contract";

export { BuildCoordinator };

type Env = AiEnv & { DESIGN_BUDGET: DurableObjectNamespace<DesignBudget>; PUBLIC_API_URL: string };
type RunTicket = { kind: "design-run"; id: string; design: string; expiresAt: number };
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
type Admission = { ok: true; maxTokens: number } | { ok: false; status: number; error: string };

const MODEL = GOD_CHAT_TIER_INFO.opus.model;
const EFFORT = GOD_CHAT_TIER_INFO.opus.effort;
const STATUS_PATHS = new Set<string>(Object.values(STATUS_VIEWS).map((view) => view.path));

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function costMicros(usage: Usage): number {
  return Math.ceil(usage.input * OPUS_PRICE.input + usage.output * OPUS_PRICE.output + usage.cacheRead * OPUS_PRICE.cacheRead + usage.cacheWrite * OPUS_PRICE.cacheWrite);
}

export class DesignBudget extends DurableObject<Env> {
  async admit(expiresAt: number): Promise<Admission> {
    const now = Date.now();
    const state = await this.ctx.storage.get<{ requests: number; output: number; cost: number; startedAt: number; inflightSince: number | null }>("state")
      ?? { requests: 0, output: 0, cost: 0, startedAt: now, inflightSince: null };
    if (now > expiresAt || now - state.startedAt > TURN_LIMITS.wallMs) return { ok: false, status: 400, error: "This turn's time budget is spent." };
    if (state.inflightSince && now - state.inflightSince < TURN_LIMITS.staleInflightMs) return { ok: false, status: 409, error: "Another model request of this turn is still running." };
    if (state.requests >= TURN_LIMITS.requests) return { ok: false, status: 429, error: "This turn's model requests are spent." };
    if (state.cost >= TURN_LIMITS.costMicroUsd) return { ok: false, status: 429, error: "This turn's cost budget is spent." };
    const maxTokens = TURN_LIMITS.outputTokens - state.output;
    if (maxTokens < 256) return { ok: false, status: 429, error: "This turn's output budget is spent." };
    await this.ctx.storage.put("state", { ...state, requests: state.requests + 1, inflightSince: now });
    return { ok: true, maxTokens };
  }

  async settle(usage: Usage): Promise<void> {
    const state = await this.ctx.storage.get<{ requests: number; output: number; cost: number; startedAt: number; inflightSince: number | null }>("state");
    if (!state) return;
    await this.ctx.storage.put("state", { ...state, output: state.output + usage.output, cost: state.cost + costMicros(usage), inflightSince: null });
  }
}

const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";

function sanitizeBlock(role: "user" | "assistant", block: unknown): object | null {
  if (!block || typeof block !== "object") return null;
  const b = block as Record<string, unknown>;
  if (b.type === "text" && typeof b.text === "string" && b.text) return { type: "text", text: text(b.text, TURN_LIMITS.toolResultChars) };
  if (role === "user" && b.type === "tool_result" && typeof b.tool_use_id === "string") {
    const content = typeof b.content === "string" ? b.content : Array.isArray(b.content)
      ? b.content.flatMap((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? [String((part as { text?: unknown }).text ?? "")] : []).join("\n")
      : "";
    return { type: "tool_result", tool_use_id: b.tool_use_id.slice(0, 128), content: text(content, TURN_LIMITS.toolResultChars) || "(empty)", is_error: b.is_error === true };
  }
  if (role === "assistant" && b.type === "thinking" && typeof b.signature === "string") return { type: "thinking", thinking: text(b.thinking, 200_000), signature: b.signature };
  if (role === "assistant" && b.type === "redacted_thinking" && typeof b.data === "string") return { type: "redacted_thinking", data: b.data };
  if (role === "assistant" && b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string" && DESIGN_TOOL_NAMES.has(b.name)) {
    return { type: "tool_use", id: b.id.slice(0, 128), name: b.name, input: b.input && typeof b.input === "object" && !Array.isArray(b.input) ? b.input : {} };
  }
  return null;
}

function sanitizeMessages(value: unknown): object[] | null {
  if (!Array.isArray(value) || !value.length || value.length > TURN_LIMITS.messages) return null;
  const out: object[] = [];
  for (const message of value) {
    const role = (message as { role?: unknown } | null)?.role;
    if (role !== "user" && role !== "assistant") continue;
    const raw = (message as { content?: unknown }).content;
    const blocks = (typeof raw === "string" ? [{ type: "text", text: raw }] : Array.isArray(raw) ? raw : [])
      .map((block) => sanitizeBlock(role, block)).filter((block): block is object => block !== null);
    if (blocks.length) out.push({ role, content: blocks });
  }
  return out.length && (out[0] as { role: string }).role === "user" ? out : null;
}

async function usageOf(stream: ReadableStream<Uint8Array>): Promise<Usage> {
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  const apply = (raw: Record<string, number | null | undefined> | undefined) => {
    if (!raw) return;
    if (raw.input_tokens != null) usage.input = raw.input_tokens;
    if (raw.output_tokens != null) usage.output = raw.output_tokens;
    if (raw.cache_read_input_tokens != null) usage.cacheRead = raw.cache_read_input_tokens;
    if (raw.cache_creation_input_tokens != null) usage.cacheWrite = raw.cache_creation_input_tokens;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6)) as { type?: string; message?: { usage?: Record<string, number> }; usage?: Record<string, number> };
          if (event.type === "message_start") apply(event.message?.usage);
          if (event.type === "message_delta") apply(event.usage);
        } catch {}
      }
    }
  } catch {}
  return usage;
}

async function verifyTicket(env: Env, value: string | null): Promise<RunTicket | null> {
  if (!value || !env.BUILD_SESSION_SECRET) return null;
  return verifyBuildToken<RunTicket>(value, env.BUILD_SESSION_SECRET, "design-run");
}

async function proxyMessages(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const ticket = await verifyTicket(env, request.headers.get("x-api-key"));
  if (!ticket) return json({ type: "error", error: { type: "authentication_error", message: "Invalid or expired run ticket." } }, 401);
  const body = await readJsonBody(request, TURN_LIMITS.bodyBytes) as { messages?: unknown; max_tokens?: unknown } | null;
  if (!body) return json({ type: "error", error: { type: "invalid_request_error", message: "Body missing or too large." } }, 413);
  const messages = sanitizeMessages(body.messages);
  if (!messages) return json({ type: "error", error: { type: "invalid_request_error", message: "Messages must start with a user turn." } }, 400);
  const budget = env.DESIGN_BUDGET.get(env.DESIGN_BUDGET.idFromName(ticket.id));
  const admission = await budget.admit(ticket.expiresAt);
  if (!admission.ok) return json({ type: "error", error: { type: "rate_limit_error", message: admission.error } }, admission.status);
  const requested = typeof body.max_tokens === "number" && body.max_tokens > 0 ? body.max_tokens : admission.maxTokens;
  const upstreamBody = {
    model: MODEL,
    max_tokens: Math.min(requested, admission.maxTokens),
    stream: true,
    system: [{ type: "text", text: PLANNER_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: DESIGN_TOOLS,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort: EFFORT },
    cache_control: { type: "ephemeral" },
    messages,
  };
  const send = anthropicFetch(env) ?? fetch;
  let upstream: Response;
  try {
    upstream = await send("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": env.ANTHROPIC_API_KEY ?? "" },
      body: JSON.stringify(upstreamBody),
      signal: request.signal,
    });
  } catch {
    ctx.waitUntil(budget.settle({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }));
    return json({ type: "error", error: { type: "api_error", message: request.signal.aborted ? "Request canceled." : "Upstream unavailable." } }, 502);
  }
  if (!upstream.ok || !upstream.body) {
    ctx.waitUntil(budget.settle({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }));
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } });
  }
  const [toClient, toMeter] = upstream.body.tee();
  ctx.waitUntil(usageOf(toMeter).then((usage) => budget.settle(usage)));
  return new Response(toClient, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "request-id": upstream.headers.get("request-id") ?? "" } });
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.startsWith(`${PATHS.status}/`)) {
    const path = url.pathname.slice(PATHS.status.length);
    if (!STATUS_PATHS.has(path)) return json({ error: "Unknown status view." }, 404);
    const upstream = await fetch(`${env.PUBLIC_API_URL}${path}`, { headers: { Accept: "application/json" } });
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  if (request.method !== "POST") return json({ error: "Not found." }, 404);
  if (url.pathname === PATHS.start) {
    if (!aiDevEnabled(env)) return json({ error: "Design sessions start from the Prophet in production." }, 403);
    const started = await startDesign(env);
    return "error" in started ? json({ error: started.error }, started.status) : json(started.session);
  }
  if (url.pathname === PATHS.turn) {
    const { designToken } = (await readJsonBody(request, 16 * 1024) ?? {}) as { designToken?: unknown };
    if (typeof designToken !== "string" || !env.BUILD_SESSION_SECRET) return json({ error: "Missing design token." }, 400);
    const admitted = await admitDesign(env, designToken);
    if ("error" in admitted) return json({ error: admitted.error, code: admitted.code }, admitted.status);
    const design = await verifyBuildToken<{ kind: "design"; id: string; expiresAt: number }>(designToken, env.BUILD_SESSION_SECRET, "design");
    const ticket: RunTicket = { kind: "design-run", id: crypto.randomUUID(), design: design!.id, expiresAt: Date.now() + TURN_LIMITS.wallMs };
    return json({ ticket: await signBuildToken(ticket, env.BUILD_SESSION_SECRET), remaining: admitted.session.remaining, limits: TURN_LIMITS });
  }
  if (url.pathname === PATHS.plan) {
    const { ticket, plan } = (await readJsonBody(request, 64 * 1024) ?? {}) as { ticket?: unknown; plan?: unknown };
    if (!await verifyTicket(env, typeof ticket === "string" ? ticket : null)) return json({ error: "Invalid or expired run ticket." }, 401);
    const checked = checkBuildPlan(plan);
    if ("error" in checked) return json({ error: `Plan rejected: ${checked.error} Fix it and call propose_build again.` }, 422);
    try {
      return json(await issuePlan(env, checked.plan));
    } catch (error) {
      return json({ error: `Plan rejected: ${error instanceof Error ? error.message : "could not sign"}` }, 422);
    }
  }
  if (url.pathname === `${PATHS.llmBase}/v1/messages`) return proxyMessages(request, env, ctx);
  return json({ error: "Not found." }, 404);
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
