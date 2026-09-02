import assert from "node:assert/strict";
import test from "node:test";

import { parseLyricsTtml, parseTtmlClock } from "./lyrics-ttml.ts";

/** 合成的样本：结构照 amp-api 返回的形状，文字是占位符 */
function ttml(timing: string, body: string, head = "") {
  return (
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" ` +
    `xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="${timing}" xml:lang="en">` +
    `<head><metadata><ttm:agent type="person" xml:id="v1"/>${head}</metadata></head>` +
    `<body dur="3:00.000"><div begin="1.000" end="20.000" itunes:songPart="Verse">${body}</div></body></tt>`
  );
}

test("时钟表达式：三种冒号写法和带单位的写法", () => {
  assert.equal(parseTtmlClock("29.188"), 29_188);
  assert.equal(parseTtmlClock("4:24.159"), 264_159);
  assert.equal(parseTtmlClock("1:02:03.500"), 3_723_500);
  assert.equal(parseTtmlClock("12.5s"), 12_500);
  assert.equal(parseTtmlClock("500ms"), 500);
  assert.equal(parseTtmlClock("2m"), 120_000);
  assert.equal(parseTtmlClock(undefined), null);
  assert.equal(parseTtmlClock("abc"), null);
  assert.equal(parseTtmlClock("1:2:3:4"), null);
});

test("行级：每个 <p> 一行，按 begin 排序，实体解码", () => {
  const parsed = parseLyricsTtml(
    ttml(
      "Line",
      `<p begin="5.000" end="7.000" itunes:key="L2" ttm:agent="v1">second &amp; more</p>` +
        `<p begin="1.000" end="3.000" itunes:key="L1" ttm:agent="v1">first &#x27;q&#39;</p>`,
    ),
  );
  assert.equal(parsed.timing, "line");
  assert.deepEqual(parsed.lines, [
    { startMs: 1_000, endMs: 3_000, text: "first 'q'" },
    { startMs: 5_000, endMs: 7_000, text: "second & more" },
  ]);
});

test("字级：逐字 span 拼回一行，span 之间的空白保留、折叠", () => {
  const parsed = parseLyricsTtml(
    ttml(
      "Word",
      `<p begin="1.000" end="3.000" itunes:key="L1" ttm:agent="v1">` +
        `<span begin="1.000" end="1.500">aa</span> <span begin="1.500" end="2.000">bb</span>` +
        `<span begin="2.000" end="3.000">cc</span></p>`,
    ),
  );
  assert.equal(parsed.timing, "word");
  assert.deepEqual(parsed.lines, [
    {
      startMs: 1_000,
      endMs: 3_000,
      text: "aa bbcc",
      // 字间的空格挂到前一个字后面，拼起来就是整句
      words: [
        { startMs: 1_000, endMs: 1_500, text: "aa " },
        { startMs: 1_500, endMs: 2_000, text: "bb" },
        { startMs: 2_000, endMs: 3_000, text: "cc" },
      ],
    },
  ]);
  assert.equal(parsed.lines[0].words!.map((w) => w.text).join(""), parsed.lines[0].text);
});

test("行级那份不带 words；套着更细 span 的外层不算字", () => {
  const line = parseLyricsTtml(ttml("Line", `<p begin="1.000" end="2.000">plain</p>`));
  assert.equal(line.lines[0].words, undefined);

  const nested = parseLyricsTtml(
    ttml(
      "Word",
      `<p begin="1.000" end="3.000"><span begin="1.000" end="3.000">` +
        `<span begin="1.000" end="2.000">x</span><span begin="2.000" end="3.000">y</span></span></p>`,
    ),
  );
  assert.deepEqual(nested.lines[0].words, [
    { startMs: 1_000, endMs: 2_000, text: "x" },
    { startMs: 2_000, endMs: 3_000, text: "y" },
  ]);
});

test("和声（x-bg）整层丢掉，包括它里面套着的逐字 span", () => {
  const parsed = parseLyricsTtml(
    ttml(
      "Word",
      `<p begin="1.000" end="4.000" itunes:key="L1" ttm:agent="v1">` +
        `<span begin="1.000" end="2.000">lead</span> ` +
        `<span ttm:role="x-bg"><span begin="2.000" end="3.000">(echo</span> <span begin="3.000" end="4.000">echo)</span></span>` +
        ` <span begin="3.500" end="4.000">tail</span></p>`,
    ),
  );
  assert.deepEqual(parsed.lines, [
    {
      startMs: 1_000,
      endMs: 4_000,
      text: "lead tail",
      words: [
        { startMs: 1_000, endMs: 2_000, text: "lead " },
        { startMs: 3_500, endMs: 4_000, text: "tail" },
      ],
    },
  ]);
});

test("head 里的翻译不当成行；timing=None 没有时间轴", () => {
  const head = `<iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation><text for="L1">nope</text></translation></translations></iTunesMetadata>`;
  const synced = parseLyricsTtml(ttml("Line", `<p begin="1.000" end="2.000">ok</p>`, head));
  assert.deepEqual(synced.lines, [{ startMs: 1_000, endMs: 2_000, text: "ok" }]);

  const unsynced = parseLyricsTtml(ttml("None", `<p>plain</p><p>text</p>`));
  assert.equal(unsynced.timing, "none");
  assert.deepEqual(unsynced.lines, []);
});

test("没有 begin 的 <p> 跳过，空行跳过，end 早于 begin 时钉回 begin", () => {
  const parsed = parseLyricsTtml(
    ttml(
      "Line",
      `<p>no timing</p><p begin="1.000" end="2.000">   </p><p begin="3.000" end="2.000">x</p><p begin="4.000">y<br/>z</p>`,
    ),
  );
  assert.deepEqual(parsed.lines, [
    { startMs: 3_000, endMs: 3_000, text: "x" },
    { startMs: 4_000, endMs: 4_000, text: "y z" },
  ]);
});

test("没有 body 时是空的", () => {
  assert.deepEqual(parseLyricsTtml(`<tt itunes:timing="Line"></tt>`).lines, []);
});
