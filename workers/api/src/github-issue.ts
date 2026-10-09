import {
  GITHUB_ISSUE_REPO,
  parseGithubIssueRequest,
  type GithubIssueResult,
} from "@shared/github-issue";

import { readJsonBody } from "./chat/guard";
import { exchangeCode, GITHUB_API, GITHUB_API_HEADERS, revoke } from "./github-oauth";
import type { Env } from "./runtime";

const MAX_BODY_BYTES = 32 * 1024;
const FOOTER = "\n\n---\n_Filed from the [homepage chat](https://lyjw.me)._";

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
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
      headers: { ...GITHUB_API_HEADERS, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
