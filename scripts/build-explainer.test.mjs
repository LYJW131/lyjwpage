import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const buildScript = fileURLToPath(new URL("./build-explainer.mjs", import.meta.url));

function buildFixture(t, markup) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "explainer-build-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const source = path.join(cwd, "docs/explainer/v2");
  fs.mkdirSync(source, { recursive: true });
  const html = '<!doctype html><meta charset="utf-8">\n' + markup;
  fs.writeFileSync(path.join(source, "index.html"), html);
  fs.writeFileSync(path.join(source, "score.mp3"), "score fixture");
  const result = spawnSync(process.execPath, [buildScript], { cwd, encoding: "utf8" });
  return { ...result, cwd, html };
}

for (const [name, markup] of [
  ["lowercase", '<script>const LOAD = []; const tag = \'<img src="dynamic.png">\';</script>'],
  ["uppercase", '<SCRIPT>const LOAD = []; const tag = \'<img src="dynamic.png">\';</SCRIPT>'],
  ["mixed case and attributes", '<ScRiPt type="text/javascript" data-label="a > b">const LOAD = []; const tag = \'<img src="dynamic.png">\';</sCrIpT>'],
  ["closing tag attributes", '<script>const LOAD = []; const tag = \'<img src="dynamic.png">\';</script ignored="yes">'],
  ["non-closing tag name", '<script>const LOAD = []; const tag = \'</scripture><img src="dynamic.png">\';</script>'],
  ["unterminated script", '<SCRIPT>const LOAD = []; const tag = \'<img src="dynamic.png">\';'],
  ["comment and data attribute", '<script>const LOAD = [];</script><!-- <img src="comment.png"> --><div data-src="metadata.png"></div>'],
  ["published URLs", '<script>const LOAD = [];</script><img src="/image.png"><a href="#part"></a><a href="HTTPS://example.test/page"></a><script src="//example.test/app.js"></script>'],
]) {
  test(`build preserves HTML with ${name}`, (t) => {
    const result = buildFixture(t, markup);
    assert.equal(result.status, 0, result.stderr);
    const output = fs.readFileSync(path.join(result.cwd, "public/explainer/index.html"), "utf8");
    const scoreHash = createHash("sha256").update("score fixture").digest("hex").slice(0, 16);
    const assets = { "score.mp3": `a/score.${scoreHash}.mp3` };
    const head = `<link rel="icon" href="/icon" type="image/png">\n<script>window.__assets = ${JSON.stringify(assets)};</script>\n`;
    assert.equal(output, result.html.replace('<meta charset="utf-8">\n', '<meta charset="utf-8">\n' + head));
    assert.equal(fs.readFileSync(path.join(result.cwd, "public/explainer", assets["score.mp3"]), "utf8"), "score fixture");
  });
}

for (const [name, markup, reference] of [
  ["double-quoted source", '<img src="missing.png">', "missing.png"],
  ["single-quoted link", "<a href='missing.html'>link</a>", "missing.html"],
  ["unquoted uppercase source", '<IMG SRC=missing.png>', "missing.png"],
  ["script source", '<script src="missing.js"></script>', "missing.js"],
  ["entity-encoded source", '<img src="missing&#46;png">', "missing.png"],
  ["template contents", '<template><img src="missing.png"></template>', "missing.png"],
  ["after permissive script close", '<SCRIPT>const tag = \'<img src="dynamic.png">\';</SCRIPT ignored><img src="missing.png">', "missing.png"],
  ["after permissive comment close", '<!-- comment --!><img src="missing.png">', "missing.png"],
  ["empty link", '<a href="">link</a>', ""],
]) {
  test(`build rejects unpublished ${name}`, (t) => {
    const result = buildFixture(t, '<script>const LOAD = [];</script>' + markup);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`index.html 引用的 ${reference} 没有发布到 a/`), result.stderr);
    assert.equal(fs.existsSync(path.join(result.cwd, "public/explainer/index.html")), false);
  });
}
