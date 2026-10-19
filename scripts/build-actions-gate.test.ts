import assert from "node:assert/strict";
import fs from "node:fs";
import test, { type TestContext } from "node:test";

import { TEXT_LIMITS, WORKER_PATHS, WORKER_TIMING, gateDecision, reviewComment, runGate } from "./build-actions.ts";
import { body, JWT, ORIGIN, packageAndPublish, parseOutputs, PNG, publishEnv, repo, RUN_ID, server, workerPath, writeFile, type Respond } from "./build-actions-harness.ts";

test("gate decisions map the review to the Worker call", () => {
  assert.deepEqual(gateDecision({ reviewResult: "success", verdict: "approve", reason: "Fine." }).worker, { message: "Plan review approved the plan; implementation is starting." });
  const declined = gateDecision({ reviewResult: "success", verdict: "reject", reason: "Adds tracking." });
  assert.equal(declined.approved, false);
  assert.deepEqual(declined.worker, { blocked: true, message: "Plan review declined: Adds tracking." });
  assert.ok(gateDecision({ reviewResult: "success", verdict: "reject", reason: "y".repeat(2000) }).worker.message.length <= TEXT_LIMITS.blockedChars);
  for (const input of [{ reviewResult: "failure", verdict: "approve" }, { reviewResult: "cancelled" }, { reviewResult: "success", verdict: "" }, { reviewResult: "success", verdict: "APPROVE" }]) {
    const decision = gateDecision(input);
    assert.equal(decision.approved, false);
    assert.deepEqual(decision.worker, { blocked: true, message: "The plan review did not finish." });
  }
  const comment = reviewComment(gateDecision({ reviewResult: "success", verdict: "reject", reason: "Pings @someone\nsecond line" }), "https://github.com/LYJW131/lyjwpage/actions/runs/9");
  assert.equal(comment, "**Plan review: declined**\n\n> Pings @​someone\n> second line\n\n[Workflow run](https://github.com/LYJW131/lyjwpage/actions/runs/9)");
});

async function gate(t: TestContext, extra: Record<string, string>, respond?: Respond) {
  const harness = await server(t, respond);
  const env = publishEnv(t, harness.base, { PR_NUMBER: "12", RUN_URL: "https://github.com/LYJW131/lyjwpage/actions/runs/7", GITHUB_TOKEN: "gh-token", GITHUB_REPOSITORY: "LYJW131/lyjwpage", GITHUB_API_URL: `${harness.base}/gh`, ...extra });
  let error: Error | null = null;
  try { await runGate({ env, io: harness.io }); } catch (caught) { error = caught as Error; }
  return { ...harness, error, outputs: parseOutputs(fs.readFileSync(env.GITHUB_OUTPUT, "utf8")) };
}

test("gate approves only after the Worker accepts the progress update", async (t) => {
  const approved = await gate(t, { REVIEW_RESULT: "success", VERDICT: "approve", REASON: "Looks good." });
  assert.equal(approved.error, null);
  assert.deepEqual(approved.outputs, { approved: "true" });
  const [comment, progress] = approved.workerRequests();
  assert.ok(comment && progress);
  assert.equal(comment.url, "/gh/repos/LYJW131/lyjwpage/issues/12/comments");
  assert.equal(comment.authorization, "Bearer gh-token");
  assert.match(body(comment).body ?? "", /^\*\*Plan review: approved\*\*\n\n> Looks good\./);
  assert.equal(progress.url, `${WORKER_PATHS.progress}?runId=${RUN_ID}`);
  assert.equal(progress.authorization, `Bearer ${JWT}`);
  assert.deepEqual(body(progress), { message: "Plan review approved the plan; implementation is starting." });
  assert.ok(approved.requests.find((entry) => entry.url.startsWith("/oidc"))?.url.endsWith(`&audience=${encodeURIComponent(`${ORIGIN}/builds/${RUN_ID}`)}`));
  assert.ok(approved.logs.includes(`::add-mask::${JWT}`));

  const declined = await gate(t, { REVIEW_RESULT: "success", VERDICT: "reject", REASON: "Collects emails." });
  assert.deepEqual(declined.outputs, { approved: "false" });
  assert.deepEqual(body(declined.workerRequests()[1]), { blocked: true, message: "Plan review declined: Collects emails." });

  const unfinished = await gate(t, { REVIEW_RESULT: "failure", VERDICT: "", REASON: "" });
  assert.deepEqual(unfinished.outputs, { approved: "false" });
  assert.deepEqual(body(unfinished.workerRequests()[1]), { blocked: true, message: "The plan review did not finish." });
});

test("gate survives a failed comment but fails when the Worker refuses", async (t) => {
  const commentDown = await gate(t, { REVIEW_RESULT: "success", VERDICT: "approve", REASON: "Fine." }, (entry) => entry.url.startsWith("/gh") ? { status: 500 } : {});
  assert.equal(commentDown.error, null);
  assert.deepEqual(commentDown.outputs, { approved: "true" });

  const workerDown = await gate(t, { REVIEW_RESULT: "success", VERDICT: "approve", REASON: "Fine." }, (entry) => entry.url.startsWith("/api") ? { status: 401, json: { error: "Invalid progress authorization." } } : {});
  assert.match(workerDown.error?.message ?? "", /HTTP 401/);
  assert.deepEqual(workerDown.outputs, { approved: "false" });

  const noOidc = await gate(t, { REVIEW_RESULT: "success", VERDICT: "approve", REASON: "Fine.", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "wrong" });
  assert.match(noOidc.error?.message ?? "", /HTTP 0/);
  assert.deepEqual(noOidc.outputs, { approved: "false" });
  assert.equal(noOidc.workerRequests().filter((entry) => entry.url.startsWith("/api")).length, 0);
});

test("Worker calls retry gateway and network failures but not refusals", async (t) => {
  const fixture = repo(t);
  writeFile(fixture.checkout, "src/edit.ts", "export const value = 3;\n");
  writeFile(fixture.checkout, ".build-output/screenshots/home.png", PNG);
  writeFile(fixture.checkout, ".build-output/screenshots.json", JSON.stringify([{ file: "home.png", caption: "Home" }]));
  let uploads = 0;
  const flaky = await packageAndPublish(t, fixture, {
    respond: (entry) => {
      if (entry.url.startsWith(WORKER_PATHS.screenshot)) return { status: 503 };
      if (entry.url.startsWith(WORKER_PATHS.upload) && ++uploads === 1) return { status: 503, json: { error: "Build authorization cannot be checked right now." } };
      return {};
    },
  });
  assert.equal(flaky.ok, true);
  assert.deepEqual(flaky.workerRequests().map(workerPath), [WORKER_PATHS.screenshot, WORKER_PATHS.upload, WORKER_PATHS.upload], "screenshots are not retried");
  assert.deepEqual(flaky.sleeps, [WORKER_TIMING.retryDelaysMs[0]]);
  assert.equal(flaky.requests.filter((entry) => entry.url.startsWith("/oidc")).length, 3);

  const gatewayDown = await gate(t, { REVIEW_RESULT: "success", VERDICT: "approve", REASON: "Fine." }, (entry) => entry.url.startsWith("/api") ? { status: 502 } : {});
  assert.match(gatewayDown.error?.message ?? "", /HTTP 502/);
  assert.equal(gatewayDown.workerRequests().filter((entry) => entry.url.startsWith("/api")).length, WORKER_TIMING.retryDelaysMs.length + 1);

  const refused = await gate(t, { REVIEW_RESULT: "success", VERDICT: "approve", REASON: "Fine." }, (entry) => entry.url.startsWith("/api") ? { status: 409 } : {});
  assert.equal(refused.workerRequests().filter((entry) => entry.url.startsWith("/api")).length, 1);
  assert.deepEqual(refused.sleeps, []);
});
