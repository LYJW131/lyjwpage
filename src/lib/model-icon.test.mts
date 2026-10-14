import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { lobehubIconsDir, parseModelMappings } from "../../scripts/model-icons.mjs";
import { BUNDLED_MODEL_ICONS, modelIconResolver, SITE_MODEL_ICONS } from "./model-icon.ts";

const upstream = parseModelMappings(fs.readFileSync(path.join(lobehubIconsDir(), "es/features/modelConfig.js"), "utf8"));
const iconOf = modelIconResolver(upstream);

test("线上出现过的模型 ID 都认得出厂商", () => {
  const cases: Array<[string, string]> = [
    ["claude-opus-5-5", "Anthropic"],
    ["claude-4.5-opus-high-thinking", "Anthropic"],
    ["swe-2-max", "Devin"],
    ["remote-magpie/devin/swe-2", "Devin"],
    ["gpt-6.1-sol", "OpenAI"],
    ["remote-magpie/codex/gpt-6.1-sol", "OpenAI"],
    ["[pi] gpt-6-astra", "OpenAI"],
    ["grok-4.7-build-fast", "Grok"],
    ["cursor-grok-4.6-xhigh-fast", "Grok"],
    ["gemini-3.8-flash-high", "Gemini"],
    ["composer-2.5-fast", "Cursor"],
    ["[pi] kimi-k3", "Moonshot"],
    ["mimo-v2.5", "XiaomiMiMo"],
    ["muse-spark-1.3-max", "Meta"],
  ];
  for (const [model, icon] of cases) assert.equal(iconOf(model), icon, model);
});

test("上游表没有的厂商名不硬凑图标", () => {
  assert.equal(iconOf("default"), null);
  assert.equal(iconOf("compactor"), null);
  assert.equal(iconOf("swedish-chef"), null);
});

test("上游表解析出的每个图标都有单色版本", () => {
  assert.ok(upstream.length >= 50, `只解析出 ${upstream.length} 条，LobeHub 的 modelConfig 结构可能变了`);
  for (const { icon } of upstream) {
    assert.ok(/^[A-Za-z0-9]+$/.test(icon), icon);
  }
});

test("站点表里的图标都随卡片打包", () => {
  const bundled: readonly string[] = BUNDLED_MODEL_ICONS;
  for (const { icon } of SITE_MODEL_ICONS) assert.ok(bundled.includes(icon), `${icon} 上游可能没有懒加载入口`);
});
