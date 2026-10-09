import assert from "node:assert/strict";
import test from "node:test";

import { buildIssueBody, type BuildPlan } from "@shared/build-routine";
import { parseGithubIssueRequest } from "@shared/github-issue";
import { issuePlan } from "./build/plan.ts";
import { handleGithubIssue } from "./github-issue.ts";
import type { BuildCoordinator } from "./build/coordinator.ts";
import type { Env } from "./runtime.ts";

const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const plan: BuildPlan = { title: "Fix card overflow", spec: "Keep the card within narrow screens.", acceptance: ["No overflow at 375px."], paths: ["src/components/god-chat.tsx"] };

function setup() {
  const used = new Set<string>();
  const env = {
    GITHUB_APP_CLIENT_SECRET: "fixture-oauth-secret",
    BUILD_SESSION_SECRET: "fixture-build-secret",
    BUILD_COORDINATOR: {
      getByName: () => ({ claimPlan: async (id: string, expiresAt: number) => {
        if (used.has(id) || expiresAt <= Date.now()) return false;
        used.add(id);
        return true;
      } }),
    } as unknown as DurableObjectNamespace<BuildCoordinator>,
  } as Env;
  const post = (body: unknown) => new Request("https://ai.test/api/github/issue", { method: "POST", body: JSON.stringify(body) });
  return { env, used, post };
}

test("issue submission requires a plan token and RFC 7636 verifier", () => {
  const valid = { planToken: "signed-plan", code: "abc123", codeVerifier };
  assert.deepEqual(parseGithubIssueRequest(valid), valid);
  for (const patch of [{ planToken: "" }, { planToken: null }, { code: "bad code" }, { codeVerifier: "short" }, { codeVerifier: "x".repeat(129) }, { codeVerifier: "+".repeat(43) }]) {
    assert.equal(parseGithubIssueRequest({ ...valid, ...patch }), null);
  }
  assert.equal(parseGithubIssueRequest({ title: "arbitrary", body: "arbitrary", code: "abc123", codeVerifier }), null);
});

test("issue uses the signed plan, forwards PKCE, revokes the user token and consumes the plan once", async () => {
  const { env, post, used } = setup();
  const proposal = await issuePlan(env, plan);
  const calls: { url: string; init?: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/login/oauth/access_token")) return Response.json({ access_token: "fixture-user-token" });
    if (url.endsWith("/issues")) return Response.json({ html_url: "https://github.com/LYJW131/lyjwpage/issues/12", number: 12 }, { status: 201 });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    const body = { planToken: proposal.token, code: "c", codeVerifier, title: "Injected title", body: "Injected body" };
    const result = await handleGithubIssue(post(body), env, "192.0.2.1");
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { url: "https://github.com/LYJW131/lyjwpage/issues/12", number: 12 });
    assert.equal(used.size, 1);
    const exchange = JSON.parse(String(calls[0].init?.body));
    assert.equal(exchange.code_verifier, codeVerifier);
    const submitted = JSON.parse(String(calls[1].init?.body));
    assert.equal(submitted.title, plan.title);
    assert.ok(submitted.body.startsWith(buildIssueBody(plan)));
    assert.doesNotMatch(submitted.body, /Injected/);
    assert.equal(calls[2].init?.method, "DELETE");
    assert.equal((await handleGithubIssue(post(body), env, "192.0.2.1")).status, 409);
    assert.equal(calls.filter(({ url }) => url.endsWith("/issues")).length, 1);
    assert.equal(calls.at(-1)?.init?.method, "DELETE");
  } finally { globalThis.fetch = original; }
});

test("invalid and expired plans make no OAuth call; failed issue creation still revokes and consumes", async () => {
  const { env, post, used } = setup();
  const proposal = await issuePlan(env, plan);
  const original = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    if (String(input).includes("/login/oauth/access_token")) return Response.json({ access_token: "fixture-user-token" });
    if (String(input).endsWith("/issues")) return Response.json({ message: "upstream arbitrary content" }, { status: 410 });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    assert.equal((await handleGithubIssue(post({ planToken: `${proposal.token}x`, code: "c", codeVerifier }), env, "ip")).status, 400);
    assert.deepEqual(methods, []);
    const result = await handleGithubIssue(post({ planToken: proposal.token, code: "c", codeVerifier }), env, "ip");
    assert.equal(result.status, 502);
    assert.doesNotMatch(await result.text(), /upstream arbitrary content/);
    assert.deepEqual(methods, ["POST", "POST", "DELETE"]);
    assert.equal(used.size, 1);
  } finally { globalThis.fetch = original; }
});
