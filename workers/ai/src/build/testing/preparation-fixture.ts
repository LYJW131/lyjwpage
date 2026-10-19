import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { BUILD_REPO, branchForRun, type BuildUpload } from "@shared/build-routine";
import type { StoredRun } from "../coordinator";
import { createBuildPullRequest, GithubBuildApi, prepareBuildPullRequest } from "../github";

export const baseSha = "a".repeat(40);
export const baseTree = "b".repeat(40);
export const runId = "c".repeat(32);
export const upload: BuildUpload = { baseSha, message: "feat: improve card", files: [{ path: "src/card.ts", mode: "100644", content: btoa("export const improved = true;") }], deletions: [] };
export const run = (): StoredRun => ({ state: { runId, branch: branchForRun(runId), phase: "triggered", createdAt: 1791590400000, updatedAt: 1791590400000 }, plan: { title: "Improve card", spec: "Make the public card clearer.", acceptance: ["The card is readable."], paths: ["src/card.ts"] }, account: "private-visitor", coauthor: "Private Visitor <private-visitor@example.test>", baseSha, uploadHash: "private-upload-hash", uploadUsed: false, uploadExpiresAt: Date.now() + 60000 });
export type Entry = { path: string; type: string; mode: string; sha: string | null };
export type PullRequest = { number: number; node_id: string; html_url: string; state: string; merged: boolean; draft: boolean; body: string; updated_at: string; head: { sha: string; ref: string; repo: { full_name: string } }; base: { ref: string; repo: { full_name: string } }; user: { id: number; login: string; type: string } };
export type Call = { path: string; method: string; body: Record<string, unknown> };

export function fixture() {
  const state = { head: null as string | null, pr: null as PullRequest | null, loseRefResponse: false, losePrResponse: false, losePushResponse: false, rejectPr: false, rejectBody: false, check: "success", otherCheck: "success", checkApp: "github-actions", checkName: "check", codeql: "success" as string | null, readyCalls: 0, changeReadyHead: false, prHeadLag: 0 };
  const calls: Call[] = [];
  const trees = new Map<string, Entry[]>([[baseTree, []]]);
  const commits = new Map<string, { sha: string; tree: { sha: string }; parents: { sha: string }[] }>([[baseSha, { sha: baseSha, tree: { sha: baseTree }, parents: [] }]]);
  const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(`/repos/${BUILD_REPO}`, "") + url.search;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body });
    if (path.startsWith("/compare/")) return Response.json({ status: "identical", merge_base_commit: { sha: baseSha } });
    if (path.startsWith("/git/commits/") && method === "GET") return Response.json(commits.get(path.split("/").at(-1)!));
    if (path.startsWith("/git/trees/") && method === "GET") return Response.json({ truncated: false, tree: trees.get(path.split("/").at(-1)!.split("?")[0]) });
    if (path === "/git/blobs") return Response.json({ sha: sha(body) });
    if (path === "/git/trees") {
      const entries = new Map(trees.get(body.base_tree)?.map((entry) => [entry.path, entry]));
      for (const entry of body.tree as Entry[]) { if (entry.sha === null) entries.delete(entry.path); else entries.set(entry.path, entry); }
      const tree = [...entries.values()];
      const id = sha(tree);
      trees.set(id, tree);
      return Response.json({ sha: id });
    }
    if (path === "/git/commits") {
      const id = sha(body);
      commits.set(id, { sha: id, tree: { sha: body.tree }, parents: body.parents.map((id: string) => ({ sha: id })) });
      return Response.json({ sha: id });
    }
    if (path.startsWith("/git/ref/heads/")) return state.head ? Response.json({ ref: `refs/heads/${branchForRun(runId)}`, object: { sha: state.head } }) : Response.json({}, { status: 404 });
    if (path === "/git/refs") {
      if (state.head) return Response.json({}, { status: 422 });
      state.head = body.sha;
      if (state.loseRefResponse) throw new Error("Lost ref response");
      return Response.json({ ref: body.ref, object: { sha: state.head } });
    }
    if (path.startsWith("/git/refs/heads/") && method === "PATCH") {
      assert.equal(body.force, false);
      state.head = body.sha;
      if (state.pr && !state.prHeadLag) state.pr.head.sha = body.sha;
      if (state.losePushResponse) throw new Error("Lost push response");
      return Response.json({ object: { sha: state.head } });
    }
    if (path.startsWith("/pulls?")) return Response.json(state.pr ? [state.pr] : []);
    if (path === "/pulls" && method === "POST") {
      if (state.rejectPr) return Response.json({}, { status: 422 });
      assert.equal(state.pr, null);
      state.pr = { number: 80, node_id: "PR_fixture", html_url: `https://github.com/${BUILD_REPO}/pull/80`, state: "open", merged: false, draft: body.draft, body: body.body, updated_at: new Date().toISOString(), head: { sha: state.head!, ref: body.head, repo: { full_name: BUILD_REPO } }, base: { ref: body.base, repo: { full_name: BUILD_REPO } }, user: { id: 338272049, login: "lyjw131[bot]", type: "Bot" } };
      if (state.losePrResponse) throw new Error("Lost PR response");
      return Response.json(state.pr);
    }
    if (path === "/pulls/80") {
      if (method === "GET" && state.prHeadLag && state.pr!.head.sha !== state.head && --state.prHeadLag === 0) state.pr!.head.sha = state.head!;
      if (method === "PATCH") {
        if (state.rejectBody) return Response.json({}, { status: 502 });
        state.pr!.body = body.body;
      }
      return Response.json(state.pr);
    }
    if (path.includes("/check-runs?")) {
      const codeql = state.codeql === null ? [] : ["javascript-typescript", "actions"].map((language) => ({ name: `Analyze (${language})`, status: "completed", conclusion: state.codeql, app: { slug: "github-actions" } }));
      const checkRuns = [{ name: state.checkName, status: "completed", conclusion: state.check, app: { slug: state.checkApp } }, { name: "Other check", status: "completed", conclusion: state.otherCheck, app: { slug: "github-actions" } }, ...codeql];
      return Response.json({ total_count: checkRuns.length, check_runs: checkRuns });
    }
    if (path.includes("/status?")) return Response.json({ total_count: 0, state: "pending", statuses: [] });
    if (path.includes("/comments?")) return Response.json([]);
    if (path === "/graphql") {
      if (String(body.query).includes("convertPullRequestToDraft")) { state.pr!.draft = true; return Response.json({ data: { convertPullRequestToDraft: { pullRequest: { isDraft: true } } } }); }
      state.readyCalls += 1;
      state.pr!.draft = false;
      if (state.changeReadyHead) state.pr!.head.sha = "f".repeat(40);
      return Response.json({ data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false, headRefOid: state.pr!.head.sha, number: 80 } } } });
    }
    assert.fail(`Unexpected ${method} ${path}`);
  };
  return { api: new GithubBuildApi("fixture", fetcher), state, calls, trees, commits };
}

export async function prepared(setup = fixture()) {
  const stored = run();
  const result = await prepareBuildPullRequest(setup.api, stored);
  stored.planCommitSha = result.planCommitSha;
  stored.state.pr = result.pr;
  return { ...setup, stored };
}

export async function published() {
  const setup = await prepared();
  setup.stored.uploadUsed = true;
  setup.stored.state.pr = await createBuildPullRequest(setup.api, setup.stored, upload, baseTree, async (sha, body) => { setup.stored.implementationHeadSha = sha; setup.stored.publicationBody = body; });
  setup.stored.state.phase = "pr_open";
  setup.stored.state.ci = { state: "success", updatedAt: Date.now() };
  return setup;
}
