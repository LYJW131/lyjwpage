import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { imageSourceFromInternalPath } from "../src/lib/image-proxy.ts";
import { imageObjectKeyFromPath } from "../src/lib/site-policy.ts";
import { SCORE_PATH_PREFIX, VIDEO_CODECS, VIDEO_LANGS, scoreInputs, scoreObjectKey, videoAssets, videoHash, videoObjectKey } from "./explainer-score.mjs";

function scoreSource(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "explainer-score-"));
  const root = path.join(base, "v2");
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "music"));
  fs.mkdirSync(path.join(root, "tools"));
  fs.mkdirSync(path.join(root, "sfx"));
  fs.mkdirSync(path.join(root, "../fonts"));
  for (const rel of ["../clawd.js", "plan.js", "score.js", "music/ch00.js", "music/ch01.js", "tools/score-mp3.mjs", "ch00.js", "film.js", "watch.js", "stream.js", "tools/video-release.mjs", "tools/browser.mjs", "sfx/pop.mp3", "../fonts/Geist.woff2"]) fs.writeFileSync(path.join(root, rel), `// ${rel}`);
  const load = JSON.stringify([["plan.js"], ["../clawd.js"], ["score.js"], ["music/ch00.js", "0"], ["music/ch01.js", "0"], ["ch00.js", "0"], ["ch01.js", "0"], ["watch.js"], ["stream.js"], ["film.js"]]);
  fs.writeFileSync(path.join(root, "index.html"), `<style>@font-face{src:url(../fonts/Geist.woff2)}</style><script>const LOAD = ${load};</script>`);
  return root;
}

test("score and video keys are served under the R2 image path prefix", (t) => {
  const assetUrl = fs.readFileSync(new URL("../shared/asset-url.ts", import.meta.url), "utf8");
  assert.match(assetUrl, new RegExp(`export const IMAGE_PATH_PREFIX = "${SCORE_PATH_PREFIX}";`));
  const root = scoreSource(t);
  const keys = [scoreObjectKey(root), ...VIDEO_LANGS.flatMap((lang) => VIDEO_CODECS.map((codec) => videoObjectKey(lang, codec, root)))];
  for (const key of keys) {
    assert.equal(imageObjectKeyFromPath(`${SCORE_PATH_PREFIX}/${key}`), key);
    assert.equal(imageSourceFromInternalPath(`${SCORE_PATH_PREFIX}/${key}`), null, "配乐和视频不进图片变体");
  }
  assert.deepEqual(Object.keys(videoAssets(root)), ["video/zh.av1.mp4", "video/zh.hevc.mp4", "video/en.av1.mp4", "video/en.hevc.mp4"]);
  assert.match(videoObjectKey("en", "hevc", root), /^[a-f0-9]{64}-en\.hevc\.mp4$/);
  assert.throws(() => videoObjectKey("fr", "av1", root));
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

test("video key changes with anything that decides the picture or the sound", (t) => {
  const root = scoreSource(t);
  for (const rel of ["index.html", "plan.js", "../clawd.js", "score.js", "music/ch01.js", "tools/score-mp3.mjs", "ch00.js", "film.js", "tools/video-release.mjs", "tools/browser.mjs", "sfx/pop.mp3", "../fonts/Geist.woff2"]) {
    const was = videoHash(root);
    fs.appendFileSync(path.join(root, rel), "\n");
    assert.notEqual(videoHash(root), was, rel);
  }
  const missing = videoHash(root);
  fs.writeFileSync(path.join(root, "ch01.js"), "");
  assert.notEqual(videoHash(root), missing, "LOAD 里还没写的章写出来以后");
  const sfx = videoHash(root);
  fs.writeFileSync(path.join(root, "sfx/knock.mp3"), "");
  assert.notEqual(videoHash(root), sfx, "新加的音效");
});

test("video key ignores player-only files", (t) => {
  const root = scoreSource(t);
  const before = videoHash(root);
  for (const rel of ["watch.js", "stream.js"]) fs.appendFileSync(path.join(root, rel), "\n");
  assert.equal(videoHash(root), before);
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
