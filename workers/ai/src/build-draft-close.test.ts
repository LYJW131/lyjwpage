import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { BUILD_REPO, BUILD_TIMEOUT_MS, branchForRun } from "@shared/build-routine";
import type { StoredRun } from "./build/coordinator.ts";
import type { Env } from "./runtime.ts";
import { buildGithubFixture, FIXTURE_PLAN_SHA, type GithubFixtureCall } from "./build/testing/github-fixture.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier !== "cloudflare:workers") return nextResolve(specifier, context);
  return { url: "data:text/javascript,export class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}", shortCircuit: true };
} });
const { BuildCoordinator } = await import("./build/coordinator.ts");
const privatePem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const runId = "5".repeat(32);
const baseSha = "a".repeat(40);
const pr = { number: 12, url: `https://github.com/${BUILD_REPO}/pull/12`, headSha: FIXTURE_PLAN_SHA, draft: true };

function setup(t: test.TestContext, override?: (call: GithubFixtureCall) => Response | undefined) {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query: string, ...bindings: (string | number)[]) {
    const stmt = db.prepare(query);
    const rows = /^\s*select/i.test(query) ? stmt.all(...bindings) : (stmt.run(...bindings), []);
    return { one() { return rows[0]; }, toArray() { return rows; } };
  } };
  const transactionSync = <T>(fn: () => T): T => { db.exec("BEGIN"); try { const value = fn(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } };
  const alarm = { at: null as number | null };
  const storage = { sql, transactionSync, getAlarm: async () => alarm.at, setAlarm: async (at: number) => { alarm.at = at; } };
  const coordinator = new BuildCoordinator({ storage } as unknown as DurableObjectState, { GITHUB_APP_PRIVATE_KEY: privatePem } as Env);
  const github = buildGithubFixture({ runId, baseSha, baseTree: "e".repeat(40), headSha: "c".repeat(40), override });
  t.mock.method(globalThis, "fetch", github.fetcher);
  const now = Date.now();
  const run: StoredRun = {
    state: { runId, branch: branchForRun(runId), phase: "triggered", createdAt: now, updatedAt: now },
    plan: { title: "Improve layout", spec: "Improve the public layout.", acceptance: ["Fits on mobile."], paths: ["src/card.tsx"] },
    account: "visitor", accountId: 42, coauthor: "Visitor <42+visitor@users.noreply.github.com>",
    baseSha, callbackOrigin: "https://api.example.test", uploadHash: "token-hash", uploadUsed: false, uploadExpiresAt: now + BUILD_TIMEOUT_MS,
  };
  assert.equal(coordinator.reserveRun(run, "plan", now + 60_000), "ok");
  const lease = coordinator.claimPreparation(runId)!;
  assert.ok(coordinator.setPrepared(runId, FIXTURE_PLAN_SHA, pr, lease));
  coordinator.releasePreparation(runId, lease);
  assert.equal(coordinator.claimDispatch(runId), true);
  const closes = () => github.calls.filter((call) => call.method === "PATCH" && call.path.endsWith("/pulls/12"));
  return { coordinator, alarm, closes };
}

test("a blocked build closes its plan-only draft and keeps the failure on the card", async (t) => {
  const { coordinator, alarm, closes } = setup(t);
  assert.equal(coordinator.blockRun(runId, "token-hash", "Plan paths are not enough."), true);
  await coordinator.alarm();
  assert.deepEqual(closes().map((call) => call.body), [{ state: "closed" }]);
  const run = coordinator.readRun(runId)!;
  assert.equal(run.draftClose, "closed");
  assert.equal(run.state.phase, "blocked");
  assert.match(run.state.reason!, /Plan paths are not enough\. The draft pull request was closed\.$/);
  assert.equal(alarm.at, null);
  coordinator.updateRun(runId, { phase: "closed", githubUpdatedAt: Date.now() });
  assert.equal(coordinator.readRun(runId)?.state.phase, "blocked");
  assert.equal(coordinator.claimReconcile(runId), false);
  await coordinator.alarm();
  assert.equal(closes().length, 1);
});

test("the sweep keeps watching running builds and closes the draft once they time out", async (t) => {
  const { coordinator, alarm, closes } = setup(t);
  await coordinator.alarm();
  assert.ok(alarm.at);
  assert.equal(closes().length, 0);
  const later = Date.now() + BUILD_TIMEOUT_MS;
  t.mock.method(Date, "now", () => later);
  alarm.at = null;
  await coordinator.alarm();
  assert.equal(coordinator.readRun(runId)?.state.phase, "timeout");
  assert.equal(closes().length, 1);
  assert.equal(alarm.at, null);
});

test("a GitHub failure while closing retries on the next sweep", async (t) => {
  let fail = true;
  const { coordinator, alarm, closes } = setup(t, (call) => call.method === "PATCH" && fail ? Response.json({}, { status: 502 }) : undefined);
  coordinator.failDispatch(runId, "The routine rejected the build request.", true);
  await coordinator.alarm();
  assert.equal(coordinator.readRun(runId)?.draftClose, undefined);
  assert.ok(alarm.at);
  fail = false;
  await coordinator.alarm();
  assert.equal(coordinator.readRun(runId)?.draftClose, "closed");
  assert.equal(closes().length, 2);
});

test("drafts that may already carry the implementation stay open for recovery", async (t) => {
  const { coordinator, alarm, closes } = setup(t);
  assert.ok(coordinator.claimUpload(runId, "token-hash"));
  coordinator.updateRun(runId, { phase: "validated" });
  assert.equal(coordinator.setImplementationHead(runId, "c".repeat(40)), true);
  coordinator.failPublication(runId, { phase: "failed", reason: "GitHub did not confirm publication." }, coordinator.readRun(runId)!.state);
  await coordinator.alarm();
  assert.equal(closes().length, 0);
  assert.equal(coordinator.readRun(runId)?.draftClose, undefined);
  assert.equal(alarm.at, null);
});

test("a draft that no longer matches the build is left alone", async (t) => {
  const { coordinator, closes } = setup(t, (call) => call.method === "GET" && call.path.endsWith("/pulls/12") ? Response.json({ draft: false }) : undefined);
  coordinator.failDispatch(runId, "The routine rejected the build request.", true);
  await coordinator.alarm();
  assert.equal(closes().length, 0);
  assert.equal(coordinator.readRun(runId)?.draftClose, "skipped");
});
