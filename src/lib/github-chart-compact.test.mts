import assert from "node:assert/strict";
import test from "node:test";

import { compactGithubChartSvg, withViewBox } from "./github-chart-compact.ts";

/** ghchart 真实输出的形状，缩到四个格子加两个标签。 */
const DAY_LABEL_STYLE =
  "fill:#767676;text-anchor:start;font-family:-apple-system, 'Segoe UI';white-space:nowrap;font-size:9px;";
const RAW = [
  '<?xml version="1.0" standalone="no"?>',
  '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="663" height="104">',
  '<rect style="fill:#72b0ff;shape-rendering:crispedges;" data-score="1" data-date="2025-08-10" x="27" y="20" width="10" height="10"/>',
  '<rect style="fill:#EEEEEE;shape-rendering:crispedges;" data-score="0" data-date="2025-08-17" x="39" y="20" width="10" height="10"/>',
  '<rect style="fill:#EEEEEE;shape-rendering:crispedges;" data-score="0" data-date="2025-08-24" x="51" y="20" width="10" height="10"/>',
  '<rect style="fill:#2563eb;shape-rendering:crispedges;" data-score="3" data-date="2025-08-31" x="63" y="20" width="10" height="10"/>',
  `<text style="${DAY_LABEL_STYLE}display:none;" x="0" y="28">Sun</text>`,
  `<text style="${DAY_LABEL_STYLE}" x="0" y="40">Mon</text>`,
  "</svg>",
].join("");

test("同色格子合并成一条 path，档位留给 CSS 上色", () => {
  const svg = compactGithubChartSvg(RAW);
  assert.ok(svg);
  assert.equal(svg.match(/<path/g)?.length, 3);
  assert.equal(svg.match(/<rect/g), null);
  // 两个空格子并进同一条，各画一段子路径
  const empty = /<path data-score="0" fill="#EEEEEE" d="([^"]+)"\/>/.exec(svg);
  assert.ok(empty);
  assert.equal(empty[1], "M39 20h10v10h-10zM51 20h10v10h-10z");
  // 空格子那条要被 globals.css 的 [data-score="0"] 选中，深色模式才不会是死白
  assert.match(svg, /data-score="0"/);
});

test("标签只留 CSS 盖不掉的字号与隐藏状态", () => {
  const svg = compactGithubChartSvg(RAW);
  assert.ok(svg);
  assert.match(svg, /<text x="0" y="28" font-size="9px" display="none">Sun<\/text>/);
  assert.match(svg, /<text x="0" y="40" font-size="9px">Mon<\/text>/);
  // fill / font-family 在 globals.css 里是 !important，内联写了也是死的
  assert.equal(svg.includes("font-family"), false);
  assert.equal(svg.includes("#767676"), false);
});

test("补 viewBox 而不是给 height 写 auto", () => {
  const svg = compactGithubChartSvg(RAW);
  assert.ok(svg);
  assert.match(svg, /viewBox="0 0 663 104"/);
  // SVG 的 height 属性只收长度值，写 auto 浏览器会在控制台报错
  assert.equal(/\bheight="auto"/.test(svg), false);
  assert.equal(/<svg[^>]*\b(width|height)=/.test(svg), false);
});

test("压完明显更小", () => {
  const svg = compactGithubChartSvg(RAW);
  assert.ok(svg);
  assert.ok(svg.length < RAW.length / 2, `${svg.length} vs ${RAW.length}`);
});

test("认不出的形状退回原样，只补 viewBox", () => {
  assert.equal(compactGithubChartSvg("<svg><g/></svg>"), null);
  assert.equal(compactGithubChartSvg('<svg width="663" height="104"></svg>'), null);

  const raw = '<svg version="1.1" width="663" height="104"><g/></svg>';
  assert.equal(withViewBox(raw), '<svg version="1.1" viewBox="0 0 663 104"><g/></svg>');
  const already = '<svg viewBox="0 0 1 1"/>';
  assert.equal(withViewBox(already), already);
});
