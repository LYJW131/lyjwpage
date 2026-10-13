import assert from "node:assert/strict";
import test from "node:test";

import { artworkPalette } from "./apple-recent";

test("调色板按背景到四个文字色的固定顺序，只留六位十六进制、补上 # 前缀", () => {
  assert.deepEqual(artworkPalette(), []);
  assert.deepEqual(artworkPalette({}), []);
  assert.deepEqual(
    artworkPalette({ bgColor: "0a1b2c", textColor1: "FFFFFF", textColor3: "aabbcc" }),
    ["#0a1b2c", "#FFFFFF", "#aabbcc"],
  );
});

test("长度不对、含非十六进制字符或非字符串的色值不进调色板", () => {
  assert.deepEqual(
    artworkPalette({
      bgColor: "12345",
      textColor1: "1234567",
      textColor2: "12xx56",
      textColor3: "#112233",
      textColor4: "90ab12",
    }),
    ["#90ab12"],
  );
});
