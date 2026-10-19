import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { BUILD_REPO, BUILD_TIMEOUT_MS, branchForRun, type BuildPlan, type BuildUpload } from "@shared/build-routine";
import type { Env } from "../../runtime";
import type { StoredRun } from "../coordinator";
import { hashToken, uploadTokenForRun } from "../token";
import { createBuildPullRequest as publishBuild, prepareBuildPullRequest, validateBuildBase, type GithubBuildApi } from "../github";
import { buildGithubFixture, FIXTURE_PLAN_SHA } from "./github-fixture";
import { createActionsOidcFixture } from "./actions-oidc";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
  return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
} });
export const { handleBuild, handleBuildIssue, handleBuildProgress, handleBuildScreenshot, handleBuildStatus, handleBuildUpload, handleGithubWebhook } = await import("../handlers.ts");
export const { BuildCoordinator } = await import("../coordinator.ts");
export const plan: BuildPlan = { title: "Improve the page", spec: "Improve the public layout.", acceptance: ["Mobile layout fits."], paths: ["src/card.tsx"] };
export const sha = "a".repeat(40);
export const treeSha = "b".repeat(40);
export const headSha = "c".repeat(40);
export const runId = "a".repeat(32);
export const buildSecret = "test-build-secret";
export const callbackOrigin = "https://api.test";
export const oidc = await createActionsOidcFixture();
export const privateKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const privatePem = privateKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
export const json = (value: unknown, status = 200) => Response.json(value, { status });
export const signIn = { code: "github-code", codeVerifier: "a".repeat(43) };
export const upload: BuildUpload = { baseSha: sha, message: "feat: improve the page", files: [{ path: "src/card.tsx", mode: "100644", content: btoa("export default true;") }], deletions: [] };

export function coordinator() {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query: string, ...bindings: (string | number)[]) {
    const stmt = db.prepare(query);
    const rows = /^\s*select/i.test(query) ? stmt.all(...bindings) : (stmt.run(...bindings), []);
    return { one() { assert.equal(rows.length, 1); return rows[0]; }, toArray() { return rows; } };
  } };
  const transactionSync = <T>(fn: () => T): T => { db.exec("BEGIN"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const instance = new BuildCoordinator({ storage: { sql, transactionSync, getAlarm: async () => null, setAlarm: async () => undefined } } as unknown as DurableObjectState, {} as Env);
  const env = { BUILD_COORDINATOR: { getByName: () => instance }, BUILD_SESSION_SECRET: buildSecret, GITHUB_APP_PRIVATE_KEY: privatePem, GITHUB_APP_CLIENT_SECRET: "oauth-fixture", GITHUB_WEBHOOK_SECRET: "webhook-fixture" } as unknown as Env;
  return { instance, env, db };
}
export async function stored(id = runId, account = "visitor"): Promise<StoredRun> {
  const now = Date.now();
  return { state: { runId: id, branch: branchForRun(id), phase: "triggered", createdAt: now, updatedAt: now }, plan, account, coauthor: "Visitor <1+visitor@users.noreply.github.com>", baseSha: sha, uploadHash: await hashToken(await uploadTokenForRun(id, buildSecret)), uploadUsed: false, uploadExpiresAt: now + BUILD_TIMEOUT_MS };
}
export async function dispatched(id = runId): Promise<StoredRun> {
  const run = await stored(id);
  return { ...run, callbackOrigin, planCommitSha: FIXTURE_PLAN_SHA, dispatchAttempted: true, state: { ...run.state, pr: { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha: FIXTURE_PLAN_SHA, draft: true } } };
}
export function post(path: string, body: unknown, token?: string) {
  return new Request(`https://api.test${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
}

export function githubFixture(extra: (path: string, body: Record<string, unknown> | null) => Response | undefined = () => undefined) {
  const calls: { path: string; method: string; body: Record<string, unknown> | null; auth?: string }[] = [];
  const fixture = buildGithubFixture({ runId, baseSha: sha, baseTree: treeSha, headSha, oidc, override: (call) => {
    const path = call.path === "/login/oauth/access_token" ? "https://github.com/login/oauth/access_token" : call.path;
    calls.push({ ...call, path });
    return extra(path, call.body);
  } });
  return { ...fixture, calls };
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

export const png =(seed: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([seed])]).toString("base64");
export function imageBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket = { async put(key: string, bytes: Uint8Array, options?: { httpMetadata?: { contentType?: string } }) { objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType }); } };
  return { objects, bucket: bucket as unknown as R2Bucket };
}
