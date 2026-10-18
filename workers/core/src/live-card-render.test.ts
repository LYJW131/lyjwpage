import assert from "node:assert/strict";
import test from "node:test";

import { liveCardTextWidth, renderLiveCard } from "./live-card-render";
import type { LiveCardView } from "./live-card-render";

const NOW = Date.parse("2026-10-19T12:00:00Z");
const ART = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

const view = (patch: Partial<LiveCardView>): LiveCardView => ({
  kind: "watching",
  title: "Title",
  subtitle: "Subtitle",
  artwork: null,
  alsoListening: null,
  lastActiveAt: null,
  ...patch,
});

const textAt = (svg: string, y: number) => {
  const m = svg.match(new RegExp(`<text x="(\\d+)" y="${y}"[^>]*>([^<]*)</text>`));
  return m === null ? null : { x: Number(m[1]), text: m[2] };
};
const unxml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

test("五种 kind 都出合法 SVG，与另外两张卡同宽、viewBox 左缘 28", () => {
  for (const kind of ["watching", "gaming", "coding", "listening", "idle"] as const) {
    const svg = renderLiveCard(view({ kind }), NOW);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="724" height="\d+" viewBox="28 0 724 \d+"/);
    assert.match(svg, /role="img"/);
  }
});

test("高度按内容固定：普通态 134，有 alsoListening 150，与 kind 无关", () => {
  assert.match(renderLiveCard(view({}), NOW), /viewBox="28 0 724 134"/);
  for (const kind of ["watching", "coding", "idle"] as const) {
    const svg = renderLiveCard(view({ kind, alsoListening: { title: "Song", artist: null } }), NOW);
    assert.match(svg, /viewBox="28 0 724 150"/);
  }
});

test("有封面时封面内联、文字从封面右侧起；没有封面时从 x=28 起", () => {
  const withArt = renderLiveCard(view({ artwork: ART }), NOW);
  assert.match(withArt, /<clipPath id="live-art"><rect x="28" y="44" width="78" height="78" rx="8"\/><\/clipPath>/);
  assert.match(withArt, /<image href="data:image\/webp;base64,UklGR[^"]*" x="28" y="44" width="78" height="78"/);
  assert.equal(textAt(withArt, 88)?.x, 124);
  const noArt = renderLiveCard(view({}), NOW);
  assert.doesNotMatch(noArt, /<image/);
  assert.equal(textAt(noArt, 88)?.x, 28);
});

test("超长中英文标题截断加省略号，估算宽度不越过右缘 752", () => {
  const cn = renderLiveCard(view({ title: "很长很长的标题".repeat(12) }), NOW);
  const cnTitle = unxml(textAt(cn, 88)?.text ?? "");
  assert.ok(cnTitle.endsWith("…"), cnTitle);
  assert.ok(liveCardTextWidth(cnTitle, 28) <= 724, cnTitle);
  const en = renderLiveCard(view({ artwork: ART, title: "W".repeat(60) }), NOW);
  const enTitle = unxml(textAt(en, 88)?.text ?? "");
  assert.ok(enTitle.endsWith("…"), enTitle);
  assert.ok(liveCardTextWidth(enTitle, 28) <= 752 - 124, enTitle);
});

test("短标题不截断、不加省略号", () => {
  const svg = renderLiveCard(view({ title: "Slow Horses" }), NOW);
  assert.equal(textAt(svg, 88)?.text, "Slow Horses");
});

test("用户文本里的 XML 特殊字符被转义", () => {
  const svg = renderLiveCard(view({
    title: `a & <b> "c" 'd'`,
    subtitle: "x<y",
    alsoListening: { title: "t&t", artist: `"'` },
  }), NOW);
  assert.match(svg, /a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;/);
  assert.match(svg, />x&lt;y</);
  assert.match(svg, /♪ t&amp;t — &quot;&apos;/);
  assert.doesNotMatch(svg, /a & </);
});

test("idle 副标题分档：59 秒 just now、3 小时 3h ago、3 天 3d ago、null 无副标题", () => {
  const at = (ms: number | null) => renderLiveCard(view({ kind: "idle", lastActiveAt: ms === null ? null : NOW - ms }), NOW);
  assert.match(at(59_000), />Last active just now</);
  assert.match(at(3 * 3_600_000 + 30_000), />Last active 3h ago</);
  assert.match(at(49 * 3_600_000), />Last active 2d ago</);
  assert.match(at(3 * 86_400_000), />Last active 3d ago</);
  const none = at(null);
  assert.match(none, />Offline</);
  assert.doesNotMatch(none, /Last active/);
});

test("alsoListening 有值时底部多一行 ♪，同样截断；artist 为 null 时只有歌名", () => {
  const svg = renderLiveCard(view({ artwork: ART, alsoListening: { title: "歌", artist: null } }), NOW);
  assert.match(svg, /<text x="124" y="138" font-size="13" fill="var\(--mute\)">♪ 歌<\/text>/);
  const long = renderLiveCard(view({ alsoListening: { title: "A".repeat(80), artist: "B" } }), NOW);
  const also = unxml(textAt(long, 138)?.text ?? "");
  assert.ok(also.endsWith("…"), also);
  assert.ok(liveCardTextWidth(also, 13) <= 724, also);
  assert.doesNotMatch(renderLiveCard(view({}), NOW), /♪/);
});

test("coding 标签行右侧带终端提示符，副标题照常", () => {
  const svg = renderLiveCard(view({ kind: "coding", title: "lyjwpage", subtitle: "workers/core · TypeScript" }), NOW);
  assert.match(svg, />NOW · CODING<\/text><text x="752" y="34" text-anchor="end"[^>]*>&gt;_<\/text>/);
  assert.equal(textAt(svg, 110)?.text, "workers/core · TypeScript");
});

test("非 idle 标题为 null 时画「—」", () => {
  assert.match(renderLiveCard(view({ title: null }), NOW), /<text x="28" y="88"[^>]*>—<\/text>/);
});
