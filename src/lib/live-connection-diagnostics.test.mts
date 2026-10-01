import assert from "node:assert/strict";
import test from "node:test";

import { createLiveConnectionDiagnostics, type LiveConnectionLog } from "./live-connection-diagnostics.ts";

const visibleOnline = { visible: true, online: true };
const hiddenOffline = { visible: false, online: false };
const abnormalClose = { cause: "socket_close", closeCode: 1006, wasClean: false, hadError: true } as const;

function harness() {
  const records: { level: "warn" | "info"; attributes: LiveConnectionLog }[] = [];
  let now = 0;
  return {
    records,
    advance: (ms: number) => { now += ms; },
    diagnostics: createLiveConnectionDiagnostics((level, attributes) => {
      records.push({ level, attributes });
    }, () => now),
  };
}

test("正常首连、已打开的预连接和主动关闭都不产生日志", () => {
  const { diagnostics, records } = harness();
  diagnostics.attempt();
  diagnostics.ready(visibleOnline);
  diagnostics.ready(visibleOnline);
  diagnostics.stop(visibleOnline);
  assert.deepEqual(records, []);
});

test("首连失败只告警一次，成功时记录实际重试次数和整轮时长", () => {
  const { diagnostics, records, advance } = harness();
  diagnostics.attempt();
  diagnostics.fail(abnormalClose, hiddenOffline);
  advance(1_000);
  diagnostics.attempt();
  diagnostics.fail(abnormalClose, hiddenOffline);
  advance(1_500);
  diagnostics.attempt();
  diagnostics.ready(visibleOnline);
  diagnostics.ready(visibleOnline);

  assert.deepEqual(records, [{
    level: "warn",
    attributes: {
      outcome: "failed", phase: "initial", cause: "socket_close", retryAttempts: 0,
      durationMs: 0, ...hiddenOffline, closeCode: 1006, wasClean: false, hadError: true,
    },
  }, {
    level: "info",
    attributes: {
      outcome: "recovered", phase: "initial", cause: "socket_close", retryAttempts: 2,
      durationMs: 2_500, ...visibleOnline, closeCode: 1006, wasClean: false, hadError: true,
    },
  }]);
});

test("已连成功后的断线独立成轮，正常关闭码和没有 error 事件不误标", () => {
  const { diagnostics, records, advance } = harness();
  diagnostics.ready(visibleOnline);
  diagnostics.fail({ cause: "socket_close", closeCode: 1001, wasClean: true, hadError: false }, visibleOnline);
  advance(1_000);
  diagnostics.attempt();
  diagnostics.ready(visibleOnline);
  advance(20_000);
  diagnostics.fail(abnormalClose, hiddenOffline);
  assert.equal(records.length, 3);
  assert.deepEqual(records.map(({ attributes }) => attributes.phase), ["reconnect", "reconnect", "reconnect"]);
  assert.equal(records[1].attributes.retryAttempts, 1);
  assert.equal(records[1].attributes.wasClean, true);
  assert.equal(records[1].attributes.hadError, false);
  assert.equal(records[2].attributes.retryAttempts, 0);
  assert.equal(records[2].attributes.durationMs, 0);
  assert.equal(records[2].attributes.hadError, true);
});

test("重复失败和可见性、bfcache 触发的额外尝试不会重置诊断轮次", () => {
  const { diagnostics, records, advance } = harness();
  diagnostics.ready(visibleOnline);
  diagnostics.fail({ cause: "resume_closed" }, hiddenOffline);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    advance(1_000);
    diagnostics.attempt();
    diagnostics.fail(abnormalClose, attempt % 2 ? visibleOnline : hiddenOffline);
  }
  assert.equal(records.length, 1);
  diagnostics.ready(visibleOnline);
  assert.equal(records.length, 2);
  assert.equal(records[1].attributes.retryAttempts, 100);
  assert.equal(records[1].attributes.durationMs, 100_000);
  assert.equal(records[1].attributes.cause, "resume_closed");
  assert.equal(records[1].attributes.phase, "reconnect");
});

test("主动清理只结束仍未恢复的一轮，未执行的定时重试不计入次数", () => {
  const { diagnostics, records, advance } = harness();
  diagnostics.ready(visibleOnline);
  diagnostics.fail(abnormalClose, visibleOnline);
  advance(500);
  diagnostics.stop(hiddenOffline);
  diagnostics.stop(hiddenOffline);
  diagnostics.ready(visibleOnline);
  assert.equal(records.length, 2);
  assert.equal(records[1].level, "info");
  assert.equal(records[1].attributes.outcome, "aborted");
  assert.equal(records[1].attributes.durationMs, 500);
  assert.equal(records[1].attributes.retryAttempts, 0);
  assert.equal(records[1].attributes.visible, false);
});

test("清理后新订阅不会继承旧重试次数、连接标记或失败上下文", () => {
  const { diagnostics, records } = harness();
  diagnostics.ready(visibleOnline);
  diagnostics.fail(abnormalClose, hiddenOffline);
  diagnostics.attempt();
  diagnostics.stop(hiddenOffline);
  diagnostics.attempt();
  diagnostics.fail({ cause: "constructor_error" }, visibleOnline);
  diagnostics.attempt();
  diagnostics.ready(visibleOnline);
  assert.deepEqual(records[2].attributes, {
    outcome: "failed", phase: "initial", cause: "constructor_error", retryAttempts: 0,
    durationMs: 0, ...visibleOnline,
  });
  assert.equal(records[3].attributes.retryAttempts, 1);
  assert.equal(records[3].attributes.closeCode, undefined);
  assert.equal(records[3].attributes.hadError, undefined);
});

test("健康连接清理后也要重置初连标记", () => {
  const { diagnostics, records } = harness();
  diagnostics.ready(visibleOnline);
  diagnostics.stop(visibleOnline);
  diagnostics.fail(abnormalClose, visibleOnline);
  assert.equal(records[0].attributes.phase, "initial");
});

test("只复制安全字段，不带出原始事件、原因、地址、标识符或载荷", () => {
  const { diagnostics, records } = harness();
  const failure = {
    ...abnormalClose,
    closeCode: 1006,
    reason: "private close reason",
    url: "wss://private.invalid/?token=secret",
    id: "private identifier",
    payload: { secret: true },
  };
  diagnostics.fail(failure, { ...visibleOnline, ...{ token: "private token" } });
  failure.closeCode = 1000;
  diagnostics.ready(visibleOnline);
  assert.equal(records[1].attributes.closeCode, 1006);
  for (const { attributes } of records) {
    assert.deepEqual(Object.keys(attributes).sort(), [
      "cause", "closeCode", "durationMs", "hadError", "online", "outcome", "phase", "retryAttempts", "visible", "wasClean",
    ]);
    assert.ok(!JSON.stringify(attributes).includes("private"));
  }
});

test("遥测抛错不会干扰连接状态、重试或清理", () => {
  const records: LiveConnectionLog[] = [];
  const diagnostics = createLiveConnectionDiagnostics((_level, attributes) => {
    records.push(attributes);
    throw new Error("telemetry unavailable");
  }, () => 0);
  assert.doesNotThrow(() => {
    diagnostics.fail(abnormalClose, visibleOnline);
    diagnostics.attempt();
    diagnostics.ready(visibleOnline);
    diagnostics.ready(visibleOnline);
    diagnostics.fail(abnormalClose, visibleOnline);
    diagnostics.stop(visibleOnline);
    diagnostics.stop(visibleOnline);
    diagnostics.fail({ cause: "constructor_error" }, visibleOnline);
  });
  assert.deepEqual(records.map(({ outcome }) => outcome), ["failed", "recovered", "failed", "aborted", "failed"]);
  assert.equal(records[1].retryAttempts, 1);
  assert.equal(records.at(-1)?.phase, "initial");
});
