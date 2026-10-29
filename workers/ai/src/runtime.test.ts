import assert from "node:assert/strict";
import test from "node:test";

import { aiDevEnabled, previewWorkerEnabled, type Env } from "./runtime.ts";

test("开发权限只认字面上的 true，带空白也算，其它写法一律不算", () => {
  assert.equal(aiDevEnabled({} as Env), false);
  assert.equal(aiDevEnabled({ AI_DEV: "true" } as Env), true);
  assert.equal(aiDevEnabled({ AI_DEV: "  true  " } as Env), true);
  assert.equal(aiDevEnabled({ AI_DEV: "1" } as Env), false);
  assert.equal(aiDevEnabled({ AI_DEV: "TRUE" } as Env), false);
  assert.equal(aiDevEnabled({ UPSTREAM_API_URL: "http://localhost:8787" } as Env & { UPSTREAM_API_URL: string }), false);
});

test("预览开关单独放行开发权限，同样也只看 true", () => {
  assert.equal(previewWorkerEnabled({} as Env), false);
  assert.equal(previewWorkerEnabled({ PREVIEW_WORKER: "true" } as Env), true);
  assert.equal(previewWorkerEnabled({ PREVIEW_WORKER: "false" } as Env), false);
  assert.equal(aiDevEnabled({ PREVIEW_WORKER: "true" } as Env), true);
});
