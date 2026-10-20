import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { BUILD_REPO, BUILD_TIMEOUT_MS, branchForRun, type BuildPlan, type BuildUpload } from "@shared/build-routine";
import type { Env } from "../../runtime";
import type { StoredRun } from "../coordinator";
import { createBuildPullRequest as publishBuild, prepareBuildPullRequest, validateBuildBase, type GithubBuildApi } from "../github";
import { buildGithubFixture, FIXTURE_PLAN_SHA } from "./github-fixture";
import { createActionsOidcFixture } from "./actions-oidc";
import { hashToken, uploadTokenForRun } from "../token";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
  return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
} });
export const { handleBuild, handleBuildStatus, handleBuildUpload, handleGithubWebhook } = await import("../handlers.ts");
export const { BuildCoordinator } = await import("../coordinator.ts");
export const plan: BuildPlan = { title: "Improve the card", spec: "Improve the public card.", acceptance: ["The card is readable."], paths: ["src/components/card.tsx"] };
export const baseSha = "a".repeat(40);
export const treeSha = "b".repeat(40);
export const headSha = "c".repeat(40);
export const runId = "d".repeat(32);
export const buildSecret = "local-review-fixture";
export const callbackOrigin = "https://api.test";
export const dispatchPath = `/repos/${BUILD_REPO}/dispatches`;
export const oidc = await createActionsOidcFixture();
export const privatePem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
export const upload: BuildUpload = { baseSha, message: "feat: improve card", files: [{ path: plan.paths[0], mode: "100644", content: btoa("export const card = true;") }], deletions: [] };

export function coordinator() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query: string, ...bindings: (string | number)[]) {
    const statement = db.prepare(query);
    const rows = /^\s*select/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
    return { one() { assert.equal(rows.length, 1); return rows[0]; }, toArray() { return rows; } };
  } };
  const transactionSync = <T>(fn: () => T): T => { db.exec("BEGIN"); try { const value = fn(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const instance = new BuildCoordinator({ storage: { sql, transactionSync, getAlarm: async () => null, setAlarm: async () => undefined } } as unknown as DurableObjectState, {} as Env);
  const env = { BUILD_COORDINATOR: { getByName: () => instance }, BUILD_SESSION_SECRET: buildSecret, GITHUB_APP_PRIVATE_KEY: privatePem, GITHUB_WEBHOOK_SECRET: "local-webhook-fixture", GITHUB_APP_CLIENT_SECRET: "local-oauth-fixture" } as unknown as Env;
  return { db, instance, env };
}

export const signIn = { code: "github-code", codeVerifier: "a".repeat(43) };

export async function stored(): Promise<StoredRun> {
  const now = Date.now();
  return { state: { runId, branch: branchForRun(runId), phase: "triggered", createdAt: now, updatedAt: now }, plan, account: "visitor", accountId: 1, coauthor: "Visitor <1+visitor@users.noreply.github.com>", baseSha, uploadHash: await hashToken(await uploadTokenForRun(runId, buildSecret)), uploadUsed: false, uploadExpiresAt: now + BUILD_TIMEOUT_MS };
}

export async function dispatched(): Promise<StoredRun> {
  const run = await stored();
  return { ...run, callbackOrigin, planCommitSha: FIXTURE_PLAN_SHA, dispatchAttempted: true, state: { ...run.state, pr: { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha: FIXTURE_PLAN_SHA, draft: true } } };
}

export function post(path: string, body: unknown, token?: string): Request {
  return new Request(`https://api.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
}

export type GithubCall = { path: string; method: string; headers: Headers; body: Record<string, unknown> | null };
export function githubFixture(override: (call: GithubCall) => Response | undefined = () => undefined) {
  return buildGithubFixture({ runId, baseSha, baseTree: treeSha, headSha, override, oidc });
}

export async function createBuildPullRequest(api: GithubBuildApi, run: StoredRun, changed: BuildUpload, validatedBaseTree?: string) {
  const baseTree = validatedBaseTree ?? await validateBuildBase(api, run, changed);
  const prepared = await prepareBuildPullRequest(api, run);
  run.planCommitSha = prepared.planCommitSha;
  run.state.pr = prepared.pr;
  return publishBuild(api, run, changed, baseTree, async (sha, body) => {
    run.implementationHeadSha = sha;
    run.publicationBody = body;
  });
}
