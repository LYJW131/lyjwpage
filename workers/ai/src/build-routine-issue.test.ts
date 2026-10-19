import assert from "node:assert/strict";
import test from "node:test";
import { BUILD_ISSUE_LOOKUP_GRACE_MS, BUILD_PLAN_TTL_MS, buildIssueMarker, buildIssueUrl, BUILD_REPO } from "@shared/build-routine";
import { GithubBuildApi, findPlanIssue } from "./build/github.ts";
import { issuePlan } from "./build/plan.ts";
import { coordinator, githubFixture, handleBuild, handleBuildIssue, json, plan, post, signIn } from "./build/testing/routine-fixture.ts";

test("issue lookup finds the plan's issue by its marker, throttles GitHub and keeps the result past plan expiry", async (t) => {
  const { env } = coordinator();
  const proposal = await issuePlan(env, plan);
  assert.ok(proposal.issueRef);
  assert.ok(new URL(buildIssueUrl(plan, proposal.issueRef)).searchParams.get("context")?.includes(buildIssueMarker(proposal.issueRef)));
  let listed: { auth: string | null; query: URLSearchParams }[] = [];
  let issues: unknown[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === `/repos/${BUILD_REPO}/installation`) return json({ id: 1 });
    if (url.pathname === "/app/installations/1/access_tokens") return json({ token: "installation-fixture" });
    if (url.pathname === `/repos/${BUILD_REPO}/issues`) { listed.push({ auth: new Headers(init?.headers).get("Authorization"), query: url.searchParams }); return json(issues); }
    return json({}, 404);
  }) as typeof fetch;
  const lookup = (token = proposal.token) => handleBuildIssue(new Request("https://api.test/api/build/issue", { headers: { Authorization: `Bearer ${token}` } }), env, fetcher);

  assert.equal((await lookup("not-a-plan")).status, 401);
  assert.deepEqual(await (await lookup()).json(), { issue: null });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].auth, "Bearer installation-fixture");
  assert.equal(listed[0].query.get("state"), "all");
  assert.equal(Date.parse(listed[0].query.get("since")!), proposal.expiresAt - BUILD_PLAN_TTL_MS);

  issues = [
    { number: 9, html_url: `https://github.com/${BUILD_REPO}/pull/9`, body: buildIssueMarker(proposal.issueRef), pull_request: {} },
    { number: 8, html_url: `https://github.com/${BUILD_REPO}/issues/8`, body: buildIssueMarker("another-plan") },
    { number: 7, html_url: `https://github.com/${BUILD_REPO}/issues/7`, body: `context\n${buildIssueMarker(proposal.issueRef)}` },
  ];
  assert.deepEqual(await (await lookup()).json(), { issue: null }, "a second check within the throttle window does not reach GitHub");
  assert.equal(listed.length, 1);

  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 11_000 });
  assert.deepEqual(await (await lookup()).json(), { issue: { number: 7, url: `https://github.com/${BUILD_REPO}/issues/7` } });
  listed = [];
  t.mock.timers.setTime(proposal.expiresAt + BUILD_ISSUE_LOOKUP_GRACE_MS / 2);
  assert.deepEqual(await (await lookup()).json(), { issue: { number: 7, url: `https://github.com/${BUILD_REPO}/issues/7` } });
  assert.equal(listed.length, 0, "a recorded issue is answered without GitHub");
  t.mock.timers.setTime(proposal.expiresAt + BUILD_ISSUE_LOOKUP_GRACE_MS + 1);
  assert.equal((await lookup()).status, 401);
});

test("issue lookup pages past newer issues until it reaches ones created before the plan", async () => {
  const since = Date.parse("2026-01-01T00:00:00Z");
  const at = (offset: number) => new Date(since + offset).toISOString();
  const filler = (from: number) => Array.from({ length: 100 }, (_, i) => ({ number: from - i, html_url: `https://github.com/${BUILD_REPO}/issues/${from - i}`, created_at: at(60_000), body: "" }));
  const pages: unknown[][] = [filler(300), [{ number: 7, html_url: `https://github.com/${BUILD_REPO}/issues/7`, created_at: at(1_000), body: buildIssueMarker("ref") }, { number: 3, html_url: `https://github.com/${BUILD_REPO}/issues/3`, created_at: at(-1_000), body: "" }]];
  const requested: string[] = [];
  const api = new GithubBuildApi("token", (async (input: RequestInfo | URL) => {
    const page = new URL(String(input)).searchParams.get("page")!;
    requested.push(page);
    return json(pages[Number(page) - 1] ?? []);
  }) as typeof fetch);
  assert.deepEqual(await findPlanIssue(api, "ref", since), { number: 7, url: `https://github.com/${BUILD_REPO}/issues/7` });
  assert.deepEqual(requested, ["1", "2"]);

  const flood = new GithubBuildApi("token", (async () => json(filler(5000))) as typeof fetch);
  await assert.rejects(findPlanIssue(flood, "ref", since), /Too many GitHub issues/);
});

test("Start build checks GitHub once for the plan's issue and refuses without consuming the plan or quota", async () => {
  const { env, instance } = coordinator();
  const proposal = await issuePlan(env, plan);
  const issue = { number: 31, html_url: `https://github.com/${BUILD_REPO}/issues/31`, body: buildIssueMarker(proposal.issueRef) };
  const { fetcher, calls } = githubFixture((path) => path === "/user" ? json({ id: 432, login: "any-visitor", name: null }) : path.startsWith(`/repos/${BUILD_REPO}/issues?`) ? json([issue]) : undefined);
  const response = await handleBuild(post("/api/build", { ...signIn, planToken: proposal.token }), env, fetcher);
  assert.equal(response.status, 409);
  assert.deepEqual((await response.json() as { issue: unknown }).issue, { number: 31, url: issue.html_url });
  assert.equal(calls.some((call) => call.path.endsWith("/git/ref/heads/main")), false);
  assert.equal(instance.isPlanUsed(proposal.issueRef!), false);
  assert.deepEqual(instance.planIssue(proposal.issueRef!), { number: 31, url: issue.html_url });
});
