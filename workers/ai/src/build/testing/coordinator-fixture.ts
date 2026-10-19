import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { BUILD_REPO, BUILD_TIMEOUT_MS, branchForRun } from "@shared/build-routine";
import type { StoredRun } from "../coordinator";
import type { Env } from "../../runtime";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
  return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
} });
export const { BuildCoordinator } = await import("../coordinator.ts");
export const runId = "1".repeat(32);
export const baseSha = "a".repeat(40);
export const planCommitSha = "b".repeat(40);
export const implementationHeadSha = "c".repeat(40);
export const pr = { number: 91, url: `https://github.com/${BUILD_REPO}/pull/91`, headSha: planCommitSha, draft: true };

export function fixture(overrides: Partial<StoredRun> = {}) {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query: string, ...bindings: (string | number)[]) {
    const stmt = db.prepare(query);
    const rows = /^\s*select/i.test(query) ? stmt.all(...bindings) : (stmt.run(...bindings), []);
    return { one() { assert.equal(rows.length, 1); return rows[0]; }, toArray() { return rows; } };
  } };
  const transactionSync = <T>(fn: () => T): T => { db.exec("BEGIN"); try { const value = fn(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const coordinator = new BuildCoordinator({ storage: { sql, transactionSync, getAlarm: async () => null, setAlarm: async () => undefined } } as unknown as DurableObjectState, {} as Env);
  const env = { BUILD_COORDINATOR: { getByName: () => coordinator } } as unknown as Env;
  const now = Date.now();
  const run: StoredRun = {
    state: { runId, branch: branchForRun(runId), phase: "triggered", createdAt: now, updatedAt: now },
    plan: { title: "Improve layout", spec: "Improve the public layout.", acceptance: ["Fits on mobile."], paths: ["src/card.tsx"] },
    account: "visitor", accountId: 42, coauthor: "Visitor <42+visitor@users.noreply.github.com>",
    baseSha, callbackOrigin: "https://api.example.test", uploadHash: "token-hash", uploadUsed: false, uploadExpiresAt: now + BUILD_TIMEOUT_MS,
    ...overrides,
  };
  assert.equal(coordinator.reserveRun(run, "plan", now + 60_000), "ok");
  return { coordinator, run, env };
}

export function prepare(coordinator: InstanceType<typeof BuildCoordinator>) {
  const token = coordinator.claimPreparation(runId);
  assert.ok(token);
  assert.equal(coordinator.setPrepared(runId, planCommitSha, pr, token)?.phase, "triggered");
  coordinator.releasePreparation(runId, token);
}

export function dispatch(coordinator: InstanceType<typeof BuildCoordinator>) {
  prepare(coordinator);
  assert.equal(coordinator.claimDispatch(runId), true);
}

export function recordImplementation(coordinator: InstanceType<typeof BuildCoordinator>) {
  dispatch(coordinator);
  assert.ok(coordinator.claimUpload(runId, "token-hash"));
  coordinator.updateRun(runId, { phase: "validated" });
  assert.equal(coordinator.setImplementationHead(runId, implementationHeadSha), true);
}

export function pullRequest(headSha = planCommitSha, number = pr.number) {
  return { repository: { full_name: BUILD_REPO }, pull_request: { number, state: "open", merged: false, draft: true, html_url: `https://github.com/${BUILD_REPO}/pull/${number}`, head: { ref: branchForRun(runId), sha: headSha, repo: { full_name: BUILD_REPO } }, base: { ref: "main" }, updated_at: new Date().toISOString() } };
}
