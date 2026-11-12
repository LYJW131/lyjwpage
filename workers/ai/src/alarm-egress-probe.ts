import { DurableObject } from "cloudflare:workers";

import { GOD_CHAT_TIER_INFO } from "../../../shared/god-chat-tiers";
import { object } from "../../../shared/json";

type ProbeEnv = { ALARM_PROBE_API_KEY?: string; ALARM_PROBE_RUNNER_PUBLIC_KEY?: string };
type ProbeResult = { status: number; elapsedMs: number; firstTextMs: number | null; startedAt: number; body: unknown; ray: string | null; colo: string | null };
const PUBLIC_KEY = "MCowBQYDK2VwAyEARMo0dPAd9vOgLYAu6OBkUIhsq15kwLCi6f2+DLW+xjc=";

export class AlarmEgressProbe extends DurableObject<ProbeEnv> {
  async synchronous(): Promise<ProbeResult> {
    const stored = await this.ctx.storage.get<ProbeResult>("sync");
    if (stored) return stored;
    const result = await this.callAnthropic();
    await this.ctx.storage.put("sync", result);
    return result;
  }

  async schedule(): Promise<void> {
    if (await this.ctx.storage.get("state")) return;
    await this.ctx.storage.transaction(async (storage) => {
      const submittedAt = Date.now();
      await storage.put({ state: "pending", submittedAt });
      await storage.setAlarm(submittedAt + 100);
    });
  }

  async result(): Promise<unknown> {
    return { state: await this.ctx.storage.get("state") ?? "missing", result: await this.ctx.storage.get("alarm") ?? null };
  }

  async alarm(): Promise<void> {
    const enteredAt = Date.now();
    if (await this.ctx.storage.get("state") !== "pending") return;
    await this.ctx.storage.put("state", "running");
    try {
      const result = await this.callAnthropic();
      const submittedAt = await this.ctx.storage.get<number>("submittedAt");
      await this.ctx.storage.put({ state: "completed", alarm: {
        ...result,
        queueMs: submittedAt == null ? null : enteredAt - submittedAt,
        submitToFirstTextMs: submittedAt == null || result.firstTextMs == null ? null : result.startedAt - submittedAt + result.firstTextMs,
        submitToCompleteMs: submittedAt == null ? null : result.startedAt - submittedAt + result.elapsedMs,
      } });
    } catch {
      await this.ctx.storage.put({ state: "failed", alarm: { error: "upstream_request_failed" } });
    }
  }

  private async callAnthropic(): Promise<ProbeResult> {
    const key = this.env.ALARM_PROBE_API_KEY;
    if (!key) throw new Error("probe credential missing");
    const started = Date.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "anthropic-version": "2026-10-21", "content-type": "application/json" },
      body: JSON.stringify({ model: GOD_CHAT_TIER_INFO.haiku.model, stream: true, max_tokens: 32, messages: [{ role: "user", content: "Reply with exactly OK." }] }),
      signal: AbortSignal.timeout(30_000),
    });
    let firstTextMs: number | null = null;
    let body: unknown;
    if (response.ok && response.body) {
      let buffered = "";
      let text = "";
      let messageId: unknown;
      let usage: unknown;
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += chunk.value;
        let boundary: number;
        while ((boundary = buffered.indexOf("\n\n")) !== -1) {
          const record = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          const data = record.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (!data) continue;
          const event = object(JSON.parse(data));
          if (event?.type === "message_start") messageId = object(event.message)?.id;
          if (event?.type === "message_delta") usage = event.usage;
          const delta = object(event?.delta);
          if (event?.type === "content_block_delta" && typeof delta?.text === "string" && delta.text.length) {
            firstTextMs ??= Date.now() - started;
            text += delta.text;
          }
        }
      }
      if (firstTextMs == null) throw new Error("probe received no model text");
      body = { messageId, text, usage };
    } else body = await response.json();
    const elapsedMs = Date.now() - started;
    const trace = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(5_000) }).then((r) => r.text()).catch(() => "");
    return { status: response.status, elapsedMs, firstTextMs, startedAt: started, body, ray: response.headers.get("cf-ray"), colo: /^colo=(\w+)$/m.exec(trace)?.[1] ?? null };
  }
}

type ProbeBindings = ProbeEnv & { ALARM_EGRESS_PROBE: DurableObjectNamespace<AlarmEgressProbe> };

export async function handleAlarmEgressProbe(request: Request, env: ProbeBindings): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.split("/").at(-1);
  const jobId = url.searchParams.get("jobId") ?? "";
  if (!/^[a-f0-9-]{36}$/.test(jobId) || !["sync", "start", "result"].includes(action ?? "")) return new Response("Not found", { status: 404 });
  if (request.method !== (action === "result" ? "GET" : "POST")) return new Response("Method not allowed", { status: 405 });
  let authorized = false;
  try {
    const signature = Uint8Array.from(atob(request.headers.get("x-probe-signature") ?? ""), (c) => c.charCodeAt(0));
    for (const encoded of [PUBLIC_KEY, env.ALARM_PROBE_RUNNER_PUBLIC_KEY].filter((value): value is string => !!value)) {
      const key = await crypto.subtle.importKey("spki", Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)), "Ed25519", false, ["verify"]);
      if (await crypto.subtle.verify("Ed25519", key, signature, new TextEncoder().encode(`${request.method}\n${url.pathname}\n${jobId}`))) { authorized = true; break; }
    }
  } catch { /* Invalid signatures must not reach the paid probe. */ }
  if (!authorized) return new Response("Forbidden", { status: 403 });
  if (!env.ALARM_PROBE_API_KEY) return new Response("Probe credential missing", { status: 503 });
  const object = env.ALARM_EGRESS_PROBE.get(env.ALARM_EGRESS_PROBE.idFromName(jobId), { locationHint: "wnam" });
  const caller = { country: request.cf?.country ?? null, colo: request.cf?.colo ?? null };
  if (action === "sync") return Response.json({ caller, result: await object.synchronous() });
  if (action === "start") {
    await object.schedule();
    return Response.json({ caller, jobId, state: "pending" }, { status: 202 });
  }
  return Response.json({ caller, jobId, ...await object.result() as Record<string, unknown> });
}
