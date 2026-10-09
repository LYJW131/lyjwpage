import { BUILD_TOKEN_MAX_CHARS, buildIssueBody } from "@shared/build-routine";
import { GITHUB_ISSUE_REPO, parseGithubIssueRequest, type GithubIssueResult } from "@shared/github-issue";

import { exchangeCode, revoke } from "./build/github-oauth";
import { consumePlan, readPlan } from "./build/plan";
import { readJsonBody } from "./chat/guard";
import type { Env } from "./runtime";

const MAX_BODY_BYTES = BUILD_TOKEN_MAX_CHARS + 4096;
const FOOTER = "\n\n---\n_Filed from the [homepage chat](https://lyjw.me)._";
const GITHUB_API = "https://api.github.com";

function fail(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleGithubIssue(request: Request, env: Env, ip: string): Promise<Response> {
  if (request.method !== "POST") return fail(405, "Method not allowed.");
  const secret = env.GITHUB_APP_CLIENT_SECRET;
  if (!secret || !env.BUILD_SESSION_SECRET || !env.BUILD_COORDINATOR) return fail(503, "Filing issues is offline right now.");
  if (env.GITHUB_ISSUE_LIMIT && !(await env.GITHUB_ISSUE_LIMIT.limit({ key: ip })).success) {
    return fail(429, "Too many issues from here. Try again in a minute.");
  }
  const parsed = parseGithubIssueRequest(await readJsonBody(request, MAX_BODY_BYTES));
  if (!parsed) return fail(400, "A signed plan and GitHub sign-in are required.");
  if (!(await readPlan(env, parsed.planToken))) return fail(400, "This plan is invalid or expired. Ask for a new plan.");

  const token = await exchangeCode(parsed.code, parsed.codeVerifier, secret);
  if (!token) return fail(401, "GitHub sign-in didn't go through. Try again.");
  try {
    const plan = await consumePlan(env, parsed.planToken);
    if (!plan) return fail(409, "This plan is expired or already used. Ask for a new plan.");
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_ISSUE_REPO}/issues`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "lyjwpage-ai",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: plan.title, body: `${buildIssueBody(plan)}${FOOTER}` }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => null)) as { html_url?: unknown; number?: unknown } | null;
    if (res.status !== 201 || typeof data?.html_url !== "string" || typeof data.number !== "number" || !Number.isSafeInteger(data.number) || data.number < 1 || data.html_url !== `https://github.com/${GITHUB_ISSUE_REPO}/issues/${data.number}`) {
      return fail(502, "GitHub did not confirm the issue. Check your GitHub issues before asking for another plan.");
    }
    const result: GithubIssueResult = { url: data.html_url, number: data.number };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return fail(502, "The issue result is unknown. Check your GitHub issues before asking for another plan.");
  } finally {
    await revoke(token, secret);
  }
}
