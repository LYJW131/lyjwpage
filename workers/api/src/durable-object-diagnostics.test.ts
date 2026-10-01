import assert from "node:assert/strict";
import test from "node:test";
import { captureBackgroundFailure, enrichDurableObjectEvent, observeDurableObject } from "./durable-object-diagnostics";

const context = { class: "LivePushRoom", method: "fetch" } as const;

test("diagnostics preserve results, synchronous execution and original exceptions without retrying", async () => {
  const response = new Response("ok");
  let calls = 0;
  const result = observeDurableObject(context, () => { calls += 1; return Promise.resolve(response); });
  assert.equal(calls, 1);
  assert.equal(await result, response);
  const failure = Object.freeze(Object.assign(new Error("storage reset"), { retryable: true, overloaded: false }));
  await assert.rejects(observeDurableObject(context, async () => { calls += 1; throw failure; }), (error) => error === failure);
  assert.equal(calls, 2);
  assert.equal(Object.isFrozen(failure), true);
});

test("inner storage operation survives outer method enrichment", async () => {
  const failure = Object.assign(new Error("reset"), { retryable: true, overloaded: false, remote: true, privatePayload: "hidden" });
  await assert.rejects(observeDurableObject(context, () => observeDurableObject(
    { ...context, storage_operation: "getAlarm" }, async () => { throw failure; },
  )));
  const event = { type: undefined, event_id: "existing", tags: { existing: "tag" }, contexts: { existing: { value: 1 } } };
  const enriched = enrichDurableObjectEvent(event, failure);
  assert.deepEqual(enriched.contexts?.durable_object, {
    ...context, storage_operation: "getAlarm", retryable: true, overloaded: false, remote: true,
  });
  assert.deepEqual(enriched.tags, {
    existing: "tag", "do.class": "LivePushRoom", "do.method": "fetch", "do.storage_operation": "getAlarm",
    "do.retryable": "true", "do.overloaded": "false", "do.remote": "true",
  });
  assert.equal(enriched.event_id, event.event_id);
  assert.deepEqual(enriched.contexts?.existing, { value: 1 });
  assert.deepEqual(event, { type: undefined, event_id: "existing", tags: { existing: "tag" }, contexts: { existing: { value: 1 } } });
  assert.equal(JSON.stringify(enriched).includes("hidden"), false);
});

test("concurrent failures keep method and operation context isolated", async () => {
  const first = new Error("first");
  const second = new Error("second");
  const failures = await Promise.allSettled([
    observeDurableObject({ ...context, storage_operation: "getAlarm" }, async () => { await Promise.resolve(); throw first; }),
    observeDurableObject({ class: "LivePushRoom", method: "alarm", storage_operation: "setAlarm" }, async () => { throw second; }),
  ]);
  assert.ok(failures.every((result) => result.status === "rejected"));
  assert.equal(enrichDurableObjectEvent({ type: undefined }, first).tags?.["do.method"], "fetch");
  assert.equal(enrichDurableObjectEvent({ type: undefined }, second).tags?.["do.method"], "alarm");
  assert.equal(enrichDurableObjectEvent({ type: undefined }, second).tags?.["do.storage_operation"], "setAlarm");
  const untouched = { type: undefined };
  assert.equal(enrichDurableObjectEvent(untouched, new Error("unrelated")), untouched);
});

test("absent, non-boolean and accessor flags stay unknown without reading payloads", () => {
  let reads = 0;
  const failure = Object.create({ remote: true }, {
    retryable: { get: () => { reads += 1; throw new Error("must not read"); } },
    overloaded: { value: "false" },
    message: { get: () => { throw new Error("must not read message"); } },
  });
  const event = enrichDurableObjectEvent({ type: undefined }, failure, "LivePushRoom");
  assert.deepEqual(event.contexts?.durable_object, { class: "LivePushRoom", remote: true });
  assert.equal(reads, 0);
});

test("throwing and cyclic proxies cannot break error enrichment", () => {
  const throwing = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("no access"); } });
  const cyclic: object = new Proxy({}, { getPrototypeOf() { return cyclic; } });
  for (const error of [throwing, cyclic]) {
    assert.deepEqual(enrichDurableObjectEvent({ type: undefined }, error, "StateHub").contexts?.durable_object, { class: "StateHub" });
  }
});

test("primitive throws and synchronous throws in async operations remain unchanged", async () => {
  for (const error of [null, undefined, "failure", 0]) {
    await assert.rejects(observeDurableObject(context, () => { throw error; }), (actual) => actual === error);
    assert.deepEqual(enrichDurableObjectEvent({ type: undefined }, error, "LivePushRoom").contexts?.durable_object, { class: "LivePushRoom" });
  }
});

test("background failures are captured once with storage context and remain rejected", async () => {
  const error = new Error("reset");
  const captured: unknown[] = [];
  const work = observeDurableObject({ ...context, storage_operation: "setAlarm" }, async () => { throw error; });
  await assert.rejects(captureBackgroundFailure(work, (failure) => {
    captured.push(enrichDurableObjectEvent({ type: undefined }, failure));
  }), (failure) => failure === error);
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0], {
    type: undefined,
    contexts: { durable_object: { ...context, storage_operation: "setAlarm" } },
    tags: { "do.class": "LivePushRoom", "do.method": "fetch", "do.storage_operation": "setAlarm" },
  });
  await captureBackgroundFailure(Promise.resolve(), () => { assert.fail("successful work must not be captured"); });
  await assert.rejects(captureBackgroundFailure(Promise.reject(error), () => { throw new Error("telemetry failed"); }), (failure) => failure === error);
});
