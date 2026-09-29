import assert from "node:assert/strict";
import test from "node:test";

import { isKnownLogNoise } from "./sentry-noise.ts";

const WARNING = "(node:4) ExperimentalWarning: vm.USE_MAIN_CONTEXT_DEFAULT_LOADER is an experimental feature and might change at any time";
const HINT = "(Use `node --trace-warnings ...` to show where the warning was created)";

test("Node 冷启动的实验特性提示是噪声（生产上的原文，尾巴接空格或换行都收）", () => {
  assert.equal(isKnownLogNoise(`${WARNING} ${HINT}`), true);
  assert.equal(isKnownLogNoise(`${WARNING}\n${HINT}`), true);
  assert.equal(isKnownLogNoise(`${WARNING}\n${HINT}\n`), true);
  assert.equal(isKnownLogNoise(WARNING), true);
  // 进程号不固定
  assert.equal(isKnownLogNoise(WARNING.replace("node:4", "node:31")), true);
});

test("真正的错误日志哪怕把这句警告原文引在里面也要留着", () => {
  assert.equal(isKnownLogNoise(`Render failed: upstream stderr said ${WARNING}`), false);
  assert.equal(isKnownLogNoise(`${WARNING} ${HINT} and then the function crashed`), false);
  assert.equal(isKnownLogNoise(`Error: boom\n${WARNING}\n${HINT}`), false);
});

test("站点自己的降级提示和别的实验特性提示都要留着", () => {
  assert.equal(isKnownLogNoise("[pulse-score] Durable Object reset because its code was updated."), false);
  assert.equal(isKnownLogNoise("[github-repo] GitHub 仓库统计尚未就绪（18 次 202），这轮不画"), false);
  assert.equal(isKnownLogNoise("(node:4) ExperimentalWarning: Type Stripping is an experimental feature"), false);
  assert.equal(isKnownLogNoise(""), false);
});
