import assert from "node:assert/strict";
import test from "node:test";

import { isPreviewProxyPath, previewWorkerEnabled } from "./preview.ts";

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

test("需要私钥或不是状态信封的路径才转给生产", () => {
  assert.equal(isPreviewProxyPath("/api/musickit/token"), true);
  assert.equal(isPreviewProxyPath("/api/lyrics"), true);
  assert.equal(isPreviewProxyPath("/api/motion-artwork"), true);
  assert.equal(isPreviewProxyPath("/api/home"), false);
  assert.equal(isPreviewProxyPath("/api/ingest/mac"), false);
});
