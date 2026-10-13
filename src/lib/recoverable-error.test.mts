import assert from "node:assert/strict";
import test from "node:test";
import type { Event } from "@sentry/react";

import { RECOVERABLE_ERROR_MESSAGE, recoverableErrorReport } from "./recoverable-error.ts";
import { redactSentryEvent } from "./sentry-redact.ts";

const PROD_418 = "Minified React error #418; visit https://react.dev/errors/418?args[]=text&args[]= for the full message";
const DEV_418 = "Hydration failed because the server rendered text didn't match the client. +  Oct 5, 2026 at 11:18 AM -  Oct 5, 2026, 11:18 AM";

test("上报文本躲开入站过滤 react-hydration-errors 匹配的原文与错误码链接", () => {
  for (const raw of [PROD_418, DEV_418]) {
    const { error } = recoverableErrorReport(new Error(raw), "\n    at WorkoutTile");
    assert.equal(error.message, RECOVERABLE_ERROR_MESSAGE);
    assert.doesNotMatch(`${error.name}: ${error.message}`, /hydrat|#4\d\d|react\.dev\/errors|reactjs\.org/i);
    assert.equal(error.cause, undefined);
  }
});

test("错误码进 tag，组件栈进 contexts.react，不带原文", () => {
  const { context } = recoverableErrorReport(new Error(PROD_418), "\n    at WorkoutTile\n    at CardBoundary");
  assert.deepEqual(context.tags, { hydration: "recoverable", reactError: "418" });
  assert.equal(context.contexts.react.componentStack, "\n    at WorkoutTile\n    at CardBoundary");
  assert.ok(!JSON.stringify(context).includes("args[]"));
  assert.equal(recoverableErrorReport(new Error(DEV_418), undefined).context.tags.reactError, "unknown");
  assert.equal(recoverableErrorReport("boom", undefined).context.contexts.react.componentStack, null);
});

test("redactSentryEvent 保留 contexts.react.componentStack", () => {
  const event = { contexts: { react: { componentStack: "\n    at WorkoutTile" } } } as unknown as Event;
  assert.equal(redactSentryEvent(event).contexts?.react?.componentStack, "\n    at WorkoutTile");
});
