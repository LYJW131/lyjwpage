import {
  branchForRun,
  fireText,
  newRunId,
  parseBuildPlan,
  type BuildFireResult,
  type BuildPlan,
  type BuildSession,
} from "@shared/build-routine";
import { parseGithubSignIn } from "@shared/github-issue";

import { fromBase64Url, toBase64Url } from "./base64url";
import { readJsonBody } from "./chat/guard";
import { exchangeCode, GITHUB_API, GITHUB_API_HEADERS, revoke } from "./github-oauth";
import type { Env } from "./runtime";

const MAX_BODY_BYTES = 64 * 1024;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PLAN_TTL_MS = 60 * 60 * 1000;
const SESSION_TAG = "build-session-v1";
const PLAN_TAG = "build-plan-v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type Connected = { login: string; id: number; name: string | null; exp: number };
export type SignedPlan = { plan: BuildPlan; id: number; exp: number };

export type BuildQuotaKind = "chat" | "fire";
// 额度缺绑定时调用方返回 false：计数失效时宁可拒绝也不放行。
export type AdmitBuild = (kind: BuildQuotaKind, account: number) => Promise<boolean>;

type BuildEnv = Pick<Env, "ROUTINE_FIRE_URL" | "ROUTINE_FIRE_TOKEN" | "BUILD_SESSION_SECRET" | "GITHUB_APP_CLIENT_SECRET">;
type Configured = Required<BuildEnv>;

export function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

// 这几样只设在分支预览上：生产 Worker 没有它们，构建的几个端点在生产上就当不存在。
export function configured(env: BuildEnv): env is Configured {
  return !!(env.ROUTINE_FIRE_URL && env.ROUTINE_FIRE_TOKEN && env.BUILD_SESSION_SECRET && env.GITHUB_APP_CLIENT_SECRET);
}

let cached: { secret: string; key: Promise<CryptoKey> } | undefined;

export function hmacKey(secret: string): Promise<CryptoKey> {
  if (cached?.secret !== secret) {
    cached = {
      secret,
      key: crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]),
    };
  }
  return cached.key;
}

// 会话与计划共用一把密钥，靠 tag 区分：一种 token 拿不去冒充另一种。
async function signToken(secret: string, tag: string, value: unknown): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify([tag, value])));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(body));
  return `${body}.${toBase64Url(signature)}`;
}

async function readToken(secret: string, tag: string, token: unknown): Promise<Record<string, unknown> | null> {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const signature = fromBase64Url(sig);
  const raw = fromBase64Url(body);
  if (!signature || !raw) return null;
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret), signature, encoder.encode(body)))) return null;
  try {
    const [found, value] = JSON.parse(decoder.decode(raw)) as [unknown, unknown];
    return found === tag && value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function signSession(secret: string, connected: Connected): Promise<string> {
  return signToken(secret, SESSION_TAG, connected);
}

export async function readSession(secret: string, token: unknown, now = Date.now()): Promise<Connected | null> {
  const value = await readToken(secret, SESSION_TAG, token);
  if (typeof value?.login !== "string" || typeof value.id !== "number") return null;
  if (typeof value.exp !== "number" || value.exp <= now) return null;
  return { login: value.login, id: value.id, name: typeof value.name === "string" ? value.name : null, exp: value.exp };
}

export function signPlan(secret: string, plan: BuildPlan, id: number, now = Date.now()): Promise<string> {
  return signToken(secret, PLAN_TAG, { plan, id, exp: now + PLAN_TTL_MS } satisfies SignedPlan);
}

// now 传 null 时不看过期：规划对话的历史里回读旧计划给模型看，只要签名对得上就行。
export async function readPlan(secret: string, token: unknown, now: number | null = Date.now()): Promise<SignedPlan | null> {
  const value = await readToken(secret, PLAN_TAG, token);
  const plan = parseBuildPlan(value?.plan);
  if (!plan || typeof value?.id !== "number" || typeof value.exp !== "number") return null;
  if (now !== null && value.exp <= now) return null;
  return { plan, id: value.id, exp: value.exp };
}

// 用 GitHub 的 noreply 地址：不需要 email 权限，GitHub 也照样把合著者认到这个账号上。
export function coauthorLine({ login, id, name }: Pick<Connected, "login" | "id" | "name">): string {
  const display = (name ?? "").replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim() || login;
  return `${display} <${id}+${login}@users.noreply.github.com>`;
}

export async function handleBuildSession(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return fail(404, "Not found.");
  if (request.method !== "POST") return fail(405, "Method not allowed.");

  const signIn = parseGithubSignIn(await readJsonBody(request, MAX_BODY_BYTES));
  if (!signIn) return fail(400, "Missing GitHub sign-in code.");

  const token = await exchangeCode(signIn.code, signIn.codeVerifier, env.GITHUB_APP_CLIENT_SECRET);
  if (!token) return fail(401, "GitHub sign-in didn't go through. Try again.");
  let user: { login?: unknown; id?: unknown; name?: unknown } | null;
  try {
    const res = await fetch(`${GITHUB_API}/user`, { headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${token}` } });
    if (!res.ok) console.warn("[build] GitHub user lookup failed", res.status);
    user = res.ok ? ((await res.json().catch(() => null)) as typeof user) : null;
  } finally {
    await revoke(token, env.GITHUB_APP_CLIENT_SECRET);
  }
  if (typeof user?.login !== "string" || typeof user.id !== "number") return fail(502, "GitHub didn't return the account.");

  const connected: Connected = {
    login: user.login,
    id: user.id,
    name: typeof user.name === "string" && user.name ? user.name : null,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const result: BuildSession = {
    session: await signSession(env.BUILD_SESSION_SECRET, connected),
    login: connected.login,
    name: connected.name,
    expiresAt: connected.exp,
  };
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}

// 只收规划对话签出的计划 token，不收访客自己写的文字：交给 routine 的需求只能出自规划模型。
export async function handleBuildFire(request: Request, env: Env, send: typeof fetch, admit: AdmitBuild): Promise<Response> {
  if (!configured(env)) return fail(404, "Not found.");
  if (request.method !== "POST") return fail(405, "Method not allowed.");

  const body = (await readJsonBody(request, MAX_BODY_BYTES)) as { plan?: unknown; session?: unknown } | null;
  const connected = await readSession(env.BUILD_SESSION_SECRET, body?.session);
  if (!connected) return fail(401, "Connect GitHub to start a build.");
  const signed = await readPlan(env.BUILD_SESSION_SECRET, body?.plan);
  if (!signed || signed.id !== connected.id) return fail(400, "This plan has expired. Ask the planner to propose it again.");
  if (!(await admit("fire", connected.id))) return fail(429, "Build limit reached for now. Try again later.");

  const runId = newRunId();
  const res = await send(env.ROUTINE_FIRE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ROUTINE_FIRE_TOKEN}`,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: fireText(runId, signed.plan, coauthorLine(connected)) }),
  });
  const data = (await res.json().catch(() => null)) as
    | { claude_code_session_url?: string; error?: { message?: string } }
    | null;
  if (!res.ok || typeof data?.claude_code_session_url !== "string") {
    console.warn("[build] routine fire failed", res.status, data?.error?.message);
    return fail(502, `The routine didn't start (${data?.error?.message ?? `HTTP ${res.status}`}).`);
  }

  console.log("[build] routine fired", { runId, login: connected.login });
  const result: BuildFireResult = { runId, branch: branchForRun(runId), sessionUrl: data.claude_code_session_url };
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
