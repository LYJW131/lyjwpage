import { DurableObject } from "cloudflare:workers";

import { GOD_CHAT_TIER_INFO } from "../../../shared/god-chat-tiers";

type ProbeEnv = { ALARM_PROBE_API_KEY?: string };
type ProbeResult = { status: number; elapsedMs: number; body: unknown; ray: string | null; colo: string | null };
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
      await storage.put("state", "pending");
      await storage.setAlarm(Date.now() + 100);
    });
  }

  async result(): Promise<unknown> {
    return { state: await this.ctx.storage.get("state") ?? "missing", result: await this.ctx.storage.get("alarm") ?? null };
  }

  async alarm(): Promise<void> {
    if (await this.ctx.storage.get("state") !== "pending") return;
    await this.ctx.storage.put("state", "running");
    try {
      const result = await this.callAnthropic();
      await this.ctx.storage.put({ state: "completed", alarm: result });
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
      body: JSON.stringify({ model: GOD_CHAT_TIER_INFO.haiku.model, max_tokens: 32, messages: [{ role: "user", content: "Reply with exactly OK." }] }),
      signal: AbortSignal.timeout(30_000),
    });
    const body: unknown = await response.json();
    const elapsedMs = Date.now() - started;
    const trace = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { signal: AbortSignal.timeout(5_000) }).then((r) => r.text()).catch(() => "");
    return { status: response.status, elapsedMs, body, ray: response.headers.get("cf-ray"), colo: /^colo=(\w+)$/m.exec(trace)?.[1] ?? null };
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
    const key = await crypto.subtle.importKey("spki", Uint8Array.from(atob(PUBLIC_KEY), (c) => c.charCodeAt(0)), "Ed25519", false, ["verify"]);
    const signature = Uint8Array.from(atob(request.headers.get("x-probe-signature") ?? ""), (c) => c.charCodeAt(0));
    authorized = await crypto.subtle.verify("Ed25519", key, signature, new TextEncoder().encode(`${request.method}\n${url.pathname}\n${jobId}`));
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
