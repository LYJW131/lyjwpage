import assert from "node:assert/strict";
import { test } from "node:test";

import type { BuildPhase, BuildRun } from "@shared/build-routine";
import { BUILD_STATUS_POLL_MS, createBuildStatusPoller } from "./build-status-polling.ts";

const run = (phase: BuildPhase): BuildRun => ({ runId: "run", branch: "claude/build-run", phase, createdAt: 1, updatedAt: 2 });
const terminalPhases = ["merged", "closed", "blocked", "failed", "timeout"] as const;
const failOnError = (error: unknown) => assert.fail(String(error));

test("restored terminal builds never poll, including after visibility changes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const phase of terminalPhases) {
    let requests = 0;
    const poller = createBuildStatusPoller({ phase, load: async () => { requests++; return run(phase); }, onRun: () => {}, onError: failOnError });
    await poller.setVisible(true);
    poller.setVisible(false);
    await poller.setVisible(true);
    t.mock.timers.tick(BUILD_STATUS_POLL_MS * 10);
    assert.equal(requests, 0, phase);
    poller.stop();
  }
});

test("the first terminal response ends polling without waiting for a render", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const phase of terminalPhases) {
    let requests = 0;
    const received: BuildRun[] = [];
    const poller = createBuildStatusPoller({ phase: "running", load: async () => { requests++; return run(phase); }, onRun: (result) => received.push(result), onError: failOnError });
    await poller.setVisible(true);
    t.mock.timers.tick(BUILD_STATUS_POLL_MS * 10);
    poller.setVisible(false);
    await poller.setVisible(true);
    assert.equal(requests, 1, phase);
    assert.equal(received[0]?.phase, phase);
    poller.stop();
  }
});

test("active builds keep refreshing, pause offscreen, and ignore aborted responses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  let resolvePending: ((run: BuildRun) => void) | undefined;
  let activeSignal: AbortSignal | undefined;
  const received: BuildRun[] = [];
  const poller = createBuildStatusPoller({
    phase: "pr_open",
    load: async (signal) => {
      requests++;
      activeSignal = signal;
      return requests === 1 ? run("pr_open") : new Promise<BuildRun>((resolve) => { resolvePending = resolve; });
    },
    onRun: (result) => received.push(result),
    onError: failOnError,
  });
  assert.equal(requests, 0);
  await poller.setVisible(true);
  t.mock.timers.tick(BUILD_STATUS_POLL_MS);
  assert.equal(requests, 2);
  poller.setVisible(false);
  assert.equal(activeSignal?.aborted, true);
  resolvePending?.(run("merged"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(received.length, 1);
  t.mock.timers.tick(BUILD_STATUS_POLL_MS * 10);
  assert.equal(requests, 2);
  const resumed = poller.setVisible(true);
  assert.equal(requests, 3);
  resolvePending?.(run("merged"));
  await resumed;
  t.mock.timers.tick(BUILD_STATUS_POLL_MS * 10);
  assert.equal(requests, 3);
  poller.stop();
});
