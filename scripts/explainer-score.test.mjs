import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SCORE_PATH_PREFIX, scoreObjectKey } from "./explainer-score.mjs";

function scoreSource(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "explainer-score-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "music"));
  fs.mkdirSync(path.join(root, "tools"));
  for (const rel of ["plan.js", "score.js", "music/ch00.js", "music/ch01.js", "tools/score-mp3.mjs", "ch00.js"]) fs.writeFileSync(path.join(root, rel), `// ${rel}`);
  return root;
}

test("score key is served under the R2 image path prefix", () => {
  const assetUrl = fs.readFileSync(new URL("../src/lib/asset-url.ts", import.meta.url), "utf8");
  assert.match(assetUrl, new RegExp(`export const IMAGE_PATH_PREFIX = "${SCORE_PATH_PREFIX}";`));
  const nextConfig = fs.readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
  assert.match(nextConfig, /IMAGE_REWRITE_SOURCE = .*\|mp3\)\)/);
});

test("score key changes with any score input", (t) => {
  const root = scoreSource(t);
  const before = scoreObjectKey(root);
  assert.match(before, /^[a-f0-9]{64}\.mp3$/);
  for (const rel of ["plan.js", "score.js", "music/ch01.js", "tools/score-mp3.mjs"]) {
    const was = scoreObjectKey(root);
    fs.appendFileSync(path.join(root, rel), "\n");
    assert.notEqual(scoreObjectKey(root), was, rel);
  }
  fs.writeFileSync(path.join(root, "music/ch02.js"), "");
  assert.notEqual(scoreObjectKey(root), before);
});

test("score key ignores scene-only changes", (t) => {
  const root = scoreSource(t);
  const before = scoreObjectKey(root);
  fs.appendFileSync(path.join(root, "ch00.js"), "\n");
  assert.equal(scoreObjectKey(root), before);
});
