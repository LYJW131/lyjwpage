import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { SCORE_PATH_PREFIX, scoreInputs, scoreObjectKey } from "./explainer-score.mjs";

function scoreSource(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "explainer-score-"));
  const root = path.join(base, "v2");
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "music"));
  fs.mkdirSync(path.join(root, "tools"));
  for (const rel of ["../clawd.js", "plan.js", "score.js", "music/ch00.js", "music/ch01.js", "tools/score-mp3.mjs", "ch00.js"]) fs.writeFileSync(path.join(root, rel), `// ${rel}`);
  return root;
}

test("score key is served under the R2 image path prefix", () => {
  const assetUrl = fs.readFileSync(new URL("../src/lib/asset-url.ts", import.meta.url), "utf8");
  assert.match(assetUrl, new RegExp(`export const IMAGE_PATH_PREFIX = "${SCORE_PATH_PREFIX}";`));
  const sitePolicy = fs.readFileSync(new URL("../src/lib/site-policy.ts", import.meta.url), "utf8");
  assert.match(sitePolicy, /IMAGE_OBJECT_PATH = .*\|mp3\)\)/);
});

test("score key changes with any score input", (t) => {
  const root = scoreSource(t);
  const before = scoreObjectKey(root);
  assert.match(before, /^[a-f0-9]{64}\.mp3$/);
  for (const rel of ["../clawd.js", "plan.js", "score.js", "music/ch01.js", "tools/score-mp3.mjs"]) {
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


test("score events have finite timing, pitch and pad parameters", () => {
  const root = new URL("../docs/explainer/v2/", import.meta.url);
  const context = vm.createContext({ window: {}, console });
  for (const rel of scoreInputs(root.pathname).filter((name) => !name.startsWith("tools/"))) vm.runInContext(fs.readFileSync(new URL(rel, root), "utf8"), context, { filename: rel });
  const score = context.window.Score.build(context.window.PLAN);
  const pitched = new Set(["bass", "mel", "tick", "lamp", "morse", "off", "ping", "hop"]);
  for (const n of score.notes) {
    assert.ok(Number.isFinite(n.t) && n.t >= 0, JSON.stringify(n));
    if (pitched.has(n.kind)) assert.ok(Number.isFinite(n.m), JSON.stringify(n));
    if (n.kind === "pad") for (const field of ["end", "level", "lp", "verb"]) assert.ok(Number.isFinite(n[field]), JSON.stringify(n));
    if (n.dur != null) assert.ok(Number.isFinite(n.dur) && n.dur > 0, JSON.stringify(n));
  }
});
