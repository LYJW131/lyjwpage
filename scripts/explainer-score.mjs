#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCORE_SOURCE = "docs/explainer/v2";
// 须与 src/lib/asset-url.ts#IMAGE_PATH_PREFIX 同步（scripts/explainer-score.test.mjs 核对）
export const SCORE_PATH_PREFIX = "/img";

// 整片配乐只由这些文件决定：键按它们的内容算，乐谱改了而时长没变也会换成新对象
export function scoreInputs(root = SCORE_SOURCE) {
  const music = fs
    .readdirSync(path.join(root, "music"))
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => `music/${name}`);
  return ["plan.js", "score.js", ...music, "tools/score-mp3.mjs"];
}

export function scoreObjectKey(root = SCORE_SOURCE) {
  const hash = createHash("sha256");
  for (const rel of scoreInputs(root)) hash.update(rel).update("\0").update(fs.readFileSync(path.join(root, rel))).update("\0");
  return `${hash.digest("hex")}.mp3`;
}

export const scorePublicPath = (root = SCORE_SOURCE) => `${SCORE_PATH_PREFIX}/${scoreObjectKey(root)}`;

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(scoreObjectKey());
