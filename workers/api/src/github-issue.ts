import {
  GITHUB_APP_CLIENT_ID,
  GITHUB_ISSUE_REPO,
  parseGithubIssueRequest,
  type GithubIssueResult,
} from "@shared/github-issue";

import { readJsonBody } from "./chat/guard";
import type { Env } from "./runtime";

const MAX_BODY_BYTES = 32 * 1024;
const FOOTER = "\n\n---\n_Filed from the [homepage chat](https://lyjw.me)._";
const GITHUB_API = "https://api.github.com";
const API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "lyjwpage-api",
};

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function exchangeCode(code: string, codeVerifier: string, secret: string): Promise<string | null> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": API_HEADERS["User-Agent"] },
    body: JSON.stringify({ client_id: GITHUB_APP_CLIENT_ID, client_secret: secret, code, code_verifier: codeVerifier }),
  });
  const data = (await res.json().catch(() => null)) as { access_token?: string; error?: string } | null;
  if (!data?.access_token) console.warn("[github-issue] code exchange failed", res.status, data?.error);
  return data?.access_token ?? null;
}

// 访客的 token 只用来开这一条 issue，用完就撤销：Worker 不存它，也不留着备用。
async function revoke(token: string, secret: string): Promise<void> {
  const res = await fetch(`${GITHUB_API}/applications/${GITHUB_APP_CLIENT_ID}/token`, {
    method: "DELETE",
    headers: { ...API_HEADERS, Authorization: `Basic ${btoa(`${GITHUB_APP_CLIENT_ID}:${secret}`)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => null);
  if (!res || res.status !== 204) console.warn("[github-issue] token revoke failed", res?.status);
}

export async function handleGithubIssue(request: Request, env: Env, ip: string): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  const secret = env.GITHUB_APP_CLIENT_SECRET;
  if (!secret) return fail(503, "Filing issues is offline right now.");
  if (env.GITHUB_ISSUE_LIMIT && !(await env.GITHUB_ISSUE_LIMIT.limit({ key: ip })).success) {
    return fail(429, "Too many issues from here. Try again in a minute.");
  }
  const parsed = parseGithubIssueRequest(await readJsonBody(request, MAX_BODY_BYTES));
  if (!parsed) return fail(400, "The issue needs a title, and both fields must fit their limits.");

  const token = await exchangeCode(parsed.code, parsed.codeVerifier, secret);
  if (!token) return fail(401, "GitHub sign-in didn't go through. Try again.");
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_ISSUE_REPO}/issues`, {
      method: "POST",
      headers: { ...API_HEADERS, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: parsed.title, body: `${parsed.body}${FOOTER}`.trim() }),
    });
    const data = (await res.json().catch(() => null)) as { html_url?: string; number?: number; message?: string } | null;
    if (res.status !== 201 || !data?.html_url || typeof data.number !== "number") {
      console.warn("[github-issue] create failed", res.status, data?.message);
      return fail(502, `GitHub didn't accept the issue (${data?.message ?? `HTTP ${res.status}`}).`);
    }
    const result: GithubIssueResult = { url: data.html_url, number: data.number };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } finally {
    await revoke(token, secret);
  }
}
