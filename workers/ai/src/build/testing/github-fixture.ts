import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { BUILD_REPO, branchForRun } from "@shared/build-routine";

export type GithubFixtureCall = { path: string; method: string; headers: Headers; body: Record<string, unknown> | null; auth?: string };
export const FIXTURE_PLAN_SHA = "d".repeat(40);
export const FIXTURE_PLAN_TREE = "f".repeat(40);
export const FIXTURE_BOT = { id: 338272049, login: "lyjw131[bot]", type: "Bot" };

export function fixturePullRequest(runId: string, headSha: string, patch: Record<string, unknown> = {}) {
  return {
    number: 12, node_id: "PR_fixture", html_url: `https://github.com/${BUILD_REPO}/pull/12`, state: "open", merged: false, draft: true,
    body: `<!-- build-run:${runId} -->`, user: FIXTURE_BOT, updated_at: new Date().toISOString(),
    head: { sha: headSha, ref: branchForRun(runId), repo: { full_name: BUILD_REPO } },
    base: { ref: "main", repo: { full_name: BUILD_REPO } }, ...patch,
  };
}

export function buildGithubFixture(options: {
  runId: string; baseSha: string; baseTree: string; headSha: string;
  override?: (call: GithubFixtureCall) => Response | undefined;
}) {
  const repoPath = `/repos/${BUILD_REPO}`;
  const calls: GithubFixtureCall[] = [];
  const refs = new Map<string, string>();
  const commits = new Map<string, { sha: string; tree: { sha: string }; parents: { sha: string }[] }>();
  const blobs = new Map<string, string>();
  const trees = new Map<string, { path: string; type: string; mode: string; sha?: string }[]>();
  let pr: ReturnType<typeof fixturePullRequest> | null = null;
  commits.set(options.baseSha, { sha: options.baseSha, tree: { sha: options.baseTree }, parents: [] });
  trees.set(options.baseTree, [{ path: "src", type: "tree", mode: "040000" }, { path: "src/components", type: "tree", mode: "040000" }, { path: "src/card.tsx", type: "blob", mode: "100644" }]);

  function seedPrepared() {
    refs.set(branchForRun(options.runId), FIXTURE_PLAN_SHA);
    commits.set(FIXTURE_PLAN_SHA, { sha: FIXTURE_PLAN_SHA, tree: { sha: FIXTURE_PLAN_TREE }, parents: [{ sha: options.baseSha }] });
    trees.set(FIXTURE_PLAN_TREE, [...trees.get(options.baseTree)!, { path: `builds/${options.runId}.md`, type: "blob", mode: "100644" }]);
    pr = fixturePullRequest(options.runId, FIXTURE_PLAN_SHA);
  }

  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const call: GithubFixtureCall = { path: url.pathname + url.search, method: init?.method ?? "GET", headers, auth: headers.get("Authorization") ?? undefined, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const overridden = options.override?.(call);
    if (overridden) {
      if (call.path === `${repoPath}/pulls/12` && overridden.ok) {
        const data = await overridden.json() as Record<string, unknown>;
        const defaults = pr ?? fixturePullRequest(options.runId, options.headSha);
        return Response.json({ ...defaults, ...data, head: { ...defaults.head, ...(data.head as object ?? {}) }, base: { ...defaults.base, ...(data.base as object ?? {}) } }, { status: overridden.status });
      }
      return overridden;
    }
    if (url.hostname !== "api.github.com") {
      if (url.hostname === "github.com" && url.pathname === "/login/oauth/access_token") return Response.json({ access_token: "oauth-fixture" });
      if (url.pathname === "/fire") return Response.json({ claude_code_session_url: "https://claude.ai/code/session_01Fixture" });
      assert.fail(`Unexpected fixture host: ${url.hostname}`);
    }
    const path = url.pathname;
    const body = call.body!;
    if (path === "/user") return Response.json({ id: 1, login: "visitor", name: "Visitor" });
    if (path.startsWith("/applications/") && call.method === "DELETE") return new Response(null, { status: 204 });
    if (path === `${repoPath}/installation`) return Response.json({ id: 1, permissions: { checks: "read", statuses: "read" } });
    if (path === "/app/installations/1/access_tokens") return Response.json({ token: "installation-fixture" });
    if (path === `${repoPath}/git/ref/heads/main`) return Response.json({ ref: "refs/heads/main", object: { sha: options.baseSha } });
    if (path.startsWith(`${repoPath}/compare/`)) return Response.json({ status: "ahead", merge_base_commit: { sha: options.baseSha } });
    if (path === `${repoPath}/git/blobs` && call.method === "POST") {
      const content = String(body.content);
      const sha = createHash("sha256").update(content).digest("hex").slice(0, 40);
      blobs.set(sha, content);
      return Response.json({ sha }, { status: 201 });
    }
    if (path === `${repoPath}/git/trees` && call.method === "POST") {
      const entries = body.tree as { path: string; type: string; mode: string; sha?: string }[];
      const sha = body.base_tree === options.baseTree ? FIXTURE_PLAN_TREE : "9".repeat(40);
      trees.set(sha, [...(trees.get(String(body.base_tree)) ?? []), ...entries]);
      return Response.json({ sha }, { status: 201 });
    }
    if (path === `${repoPath}/git/commits` && call.method === "POST") {
      const parents = body.parents as string[];
      const sha = parents[0] === options.baseSha ? FIXTURE_PLAN_SHA : options.headSha;
      commits.set(sha, { sha, tree: { sha: String(body.tree) }, parents: parents.map((parent) => ({ sha: parent })) });
      return Response.json({ sha }, { status: 201 });
    }
    if (path.startsWith(`${repoPath}/git/commits/`)) {
      const sha = path.slice(`${repoPath}/git/commits/`.length);
      if (sha === FIXTURE_PLAN_SHA && !commits.has(sha)) seedPrepared();
      return commits.has(sha) ? Response.json(commits.get(sha)) : Response.json({}, { status: 404 });
    }
    if (path.startsWith(`${repoPath}/git/trees/`)) {
      const sha = path.slice(`${repoPath}/git/trees/`.length);
      return Response.json({ sha, truncated: false, tree: trees.get(sha) ?? [] });
    }
    if (path === `${repoPath}/git/refs` && call.method === "POST") {
      const branch = String(body.ref).replace("refs/heads/", "");
      if (refs.has(branch)) return Response.json({}, { status: 422 });
      refs.set(branch, String(body.sha));
      return Response.json({ ref: body.ref, object: { sha: body.sha } }, { status: 201 });
    }
    if (path.startsWith(`${repoPath}/git/ref/heads/`)) {
      const branch = path.slice(`${repoPath}/git/ref/heads/`.length);
      return refs.has(branch) ? Response.json({ ref: `refs/heads/${branch}`, object: { sha: refs.get(branch) } }) : Response.json({}, { status: 404 });
    }
    if (path.startsWith(`${repoPath}/git/refs/heads/`) && call.method === "PATCH") {
      assert.equal(body.force, false);
      const branch = path.slice(`${repoPath}/git/refs/heads/`.length);
      refs.set(branch, String(body.sha));
      if (pr?.head.ref === branch) pr = { ...pr, head: { ...pr.head, sha: String(body.sha) } };
      return Response.json({ ref: `refs/heads/${branch}`, object: { sha: body.sha } });
    }
    if (path === `${repoPath}/pulls` && call.method === "GET") return Response.json(pr ? [pr] : []);
    if (path === `${repoPath}/pulls` && call.method === "POST") {
      const branch = String(body.head);
      const id = branch.replace("claude/build-", "");
      pr = fixturePullRequest(id, refs.get(branch)!, { body: body.body, draft: body.draft });
      return Response.json(pr, { status: 201 });
    }
    if (path === `${repoPath}/pulls/12`) {
      if (!pr) seedPrepared();
      if (call.method === "PATCH") pr = { ...pr!, ...body };
      return Response.json(pr);
    }
    if (path.endsWith("/check-runs")) return Response.json({ total_count: 1, check_runs: [{ name: "check", status: "completed", conclusion: "success", app: { slug: "github-actions" } }] });
    if (path.endsWith("/status")) return Response.json({ total_count: 0, statuses: [] });
    if (path === `${repoPath}/issues/12/comments`) return call.method === "POST" ? Response.json({ id: 1 }, { status: 201 }) : Response.json([]);
    if (path === "/graphql") {
      pr = { ...pr!, draft: false };
      return Response.json({ data: { markPullRequestReadyForReview: { pullRequest: { id: "PR_fixture", number: 12, isDraft: false, headRefOid: pr.head.sha } } } });
    }
    assert.fail(`Unexpected fixture request: ${call.method} ${call.path}`);
  };
  return { calls, fetcher, refs, commits, blobs, seedPrepared };
}
