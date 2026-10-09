import {
  BUILD_REQUEST_MAX_CHARS,
  branchForRun,
  fireText,
  newRunId,
  type BuildFireResult,
} from "@shared/build-routine";

import { readJsonBody } from "./chat/guard";
import type { Env } from "./runtime";

const MAX_BODY_BYTES = 64 * 1024;

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

// 令牌只设在分支预览上：生产 Worker 没有它，这个端点在生产上就当不存在。
export async function handleBuildFire(request: Request, env: Env, send: typeof fetch): Promise<Response> {
  const fireUrl = env.ROUTINE_FIRE_URL;
  const token = env.ROUTINE_FIRE_TOKEN;
  if (!fireUrl || !token) return fail(404, "Not found.");
  if (request.method !== "POST") return fail(405, "Method not allowed.");

  const body = (await readJsonBody(request, MAX_BODY_BYTES)) as { request?: unknown } | null;
  const text = typeof body?.request === "string" ? body.request.trim() : "";
  if (!text || text.length > BUILD_REQUEST_MAX_CHARS) {
    return fail(400, `Describe the change in 1–${BUILD_REQUEST_MAX_CHARS} characters.`);
  }

  const runId = newRunId();
  const res = await send(fireUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: fireText(runId, text) }),
  });
  const data = (await res.json().catch(() => null)) as
    | { claude_code_session_url?: string; error?: { message?: string } }
    | null;
  if (!res.ok || typeof data?.claude_code_session_url !== "string") {
    console.warn("[build] routine fire failed", res.status, data?.error?.message);
    return fail(502, `The routine didn't start (${data?.error?.message ?? `HTTP ${res.status}`}).`);
  }

  const result: BuildFireResult = { runId, branch: branchForRun(runId), sessionUrl: data.claude_code_session_url };
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
