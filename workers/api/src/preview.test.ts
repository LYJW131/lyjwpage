import assert from "node:assert/strict";
import test from "node:test";

import { previewWorkerEnabled } from "./preview.ts";

function withPreviewFlag(value: string | undefined, run: () => void | Promise<void>) {
  const previous = process.env.PREVIEW_WORKER;
  if (value === undefined) delete process.env.PREVIEW_WORKER;
  else process.env.PREVIEW_WORKER = value;
  const restore = () => {
    if (previous === undefined) delete process.env.PREVIEW_WORKER;
    else process.env.PREVIEW_WORKER = previous;
  };
  try {
    const result = run();
    if (result && typeof result.then === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test("只有 PREVIEW_WORKER=true 才算影子 Worker", () => {
  withPreviewFlag(undefined, () => {
    assert.equal(previewWorkerEnabled(), false);
  });
  withPreviewFlag("yes", () => {
    assert.equal(previewWorkerEnabled(), false);
  });
  withPreviewFlag("true", () => {
    assert.equal(previewWorkerEnabled(), true);
  });
});
