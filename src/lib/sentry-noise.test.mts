import assert from "node:assert/strict";
import test from "node:test";

import { isKnownLogNoise } from "./sentry-noise.ts";

test("Node 冷启动的实验特性提示是噪声（生产上的原文）", () => {
  assert.equal(
    isKnownLogNoise(
      "(node:4) ExperimentalWarning: vm.USE_MAIN_CONTEXT_DEFAULT_LOADER is an experimental feature and might change at any time (Use `node --trace-warnings ...` to show where the warning was created)",
    ),
    true,
  );
});

test("站点自己的降级提示和别的实验特性提示都要留着", () => {
  assert.equal(isKnownLogNoise("[pulse-score] Durable Object reset because its code was updated."), false);
  assert.equal(isKnownLogNoise("[github-repo] GitHub 仓库统计尚未就绪（18 次 202），这轮不画"), false);
  assert.equal(isKnownLogNoise("(node:4) ExperimentalWarning: Type Stripping is an experimental feature"), false);
  assert.equal(isKnownLogNoise(""), false);
});
