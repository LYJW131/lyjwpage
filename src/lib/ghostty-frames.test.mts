import assert from "node:assert/strict";
import test from "node:test";

import frameData from "./ghostty-frames.json" with { type: "json" };
import { decodeGhosttyFrame, decodeGhosttyFrames, ghosttyRowWidths } from "./ghostty-frames.ts";

const data = frameData;

test("游程解码：同一档合成一条 path，空白不画，单个符号不带计数", () => {
  const layers = decodeGhosttyFrame("2 3#/b#2b", data.levels);
  assert.deepEqual(layers, [
    { fill: "body", opacity: 1, d: "M2 0h3v1h-3zM1 1h1v1h-1z" },
    { fill: "glow", opacity: 0.6, d: "M0 1h1v1h-1zM2 1h2v1h-2z" },
  ]);
  assert.deepEqual(ghosttyRowWidths("2 3#/b#2b"), [5, 4]);
});

test("压制出来的每一帧都铺满 columns × rows", () => {
  assert.ok(data.frames.length > 0);
  assert.ok(data.frameMs > 0);
  for (const [index, frame] of data.frames.entries()) {
    const widths = ghosttyRowWidths(frame);
    assert.equal(widths.length, data.rows, `第 ${index} 帧行数`);
    assert.ok(
      widths.every((width) => width === data.columns),
      `第 ${index} 帧有行没铺满：${widths.join(",")}`,
    );
  }
});

test("每一帧都同时画出幽灵本体和蓝色光环", () => {
  for (const [index, layers] of decodeGhosttyFrames(data).entries()) {
    const fills = new Set(layers.map((layer) => layer.fill));
    assert.ok(fills.has("body") && fills.has("glow"), `第 ${index} 帧缺层：${[...fills].join(",")}`);
  }
});
