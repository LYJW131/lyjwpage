import assert from "node:assert/strict";
import test from "node:test";

import { GOD_CHAT_VISUAL_EXAMPLES, GOD_CHAT_VISUAL_KINDS, GOD_CHAT_VISUAL_LIMITS } from "@shared/god-chat";
import { formatVisualNumber, niceTicks, parsePartialVisual, parseVisual } from "@/lib/chat-visuals";

test("提示词里印的每个例子都能过校验", () => {
  for (const kind of GOD_CHAT_VISUAL_KINDS) {
    assert.ok(parseVisual(kind, JSON.stringify(GOD_CHAT_VISUAL_EXAMPLES[kind])), kind);
  }
});

test("结构不对整块不画，交回代码块", () => {
  assert.equal(parseVisual("chart", "{"), null);
  assert.equal(parseVisual("chart", JSON.stringify({ type: "pie", labels: ["a"], series: [{ name: "x", values: [1] }] })), null);
  assert.equal(parseVisual("chart", JSON.stringify({ type: "bar", labels: ["a", "b"], series: [{ name: "x", values: [1] }] })), null);
  assert.equal(parseVisual("chart", JSON.stringify({ type: "column", labels: ["a"], series: [{ name: "x", values: [-1] }] })), null);
  assert.equal(parseVisual("stats", JSON.stringify({ items: [] })), null);
  assert.equal(parseVisual("timeline", JSON.stringify([{ time: "1", title: "a" }])), null);
  assert.equal(parseVisual("chart", JSON.stringify({ type: "bar", labels: ["a", "", "c"], series: [{ name: "x", values: [1, 2, 3] }] })), null);
});

test("局部不合格只丢那一部分：长文字截断、多出的条目截尾、坏条目与坏序列丢掉，其余照画", () => {
  const long = "很".repeat(GOD_CHAT_VISUAL_LIMITS.label + 5);
  const stats = parseVisual("stats", JSON.stringify({
    items: [{ label: long, value: "1" }, { label: "bad" }, ...Array.from({ length: 6 }, (_, i) => ({ label: `s${i}`, value: String(i) }))],
    summary: { label: "no value" },
  }));
  assert.ok(stats?.kind === "stats");
  assert.equal(stats.items.length, GOD_CHAT_VISUAL_LIMITS.stats);
  assert.equal([...stats.items[0].label].length, GOD_CHAT_VISUAL_LIMITS.label);
  assert.ok(stats.items[0].label.endsWith("…"));
  assert.deepEqual(stats.items.slice(1).map((item) => item.label), ["s0", "s1", "s2"]);
  assert.equal(stats.summary, undefined);

  const chart = parseVisual("chart", JSON.stringify({
    type: "column",
    labels: Array.from({ length: GOD_CHAT_VISUAL_LIMITS.columnLabels + 2 }, (_, i) => `d${i}`),
    series: [
      { name: "ok", values: Array.from({ length: GOD_CHAT_VISUAL_LIMITS.columnLabels + 2 }, (_, i) => i) },
      { name: "short", values: [1, 2] },
      { name: "negative", values: Array.from({ length: GOD_CHAT_VISUAL_LIMITS.columnLabels + 2 }, () => -1) },
    ],
  }));
  assert.ok(chart?.kind === "chart");
  assert.equal(chart.labels.length, GOD_CHAT_VISUAL_LIMITS.columnLabels);
  assert.deepEqual(chart.series.map((series) => [series.name, series.values.length]), [["ok", GOD_CHAT_VISUAL_LIMITS.columnLabels]]);

  const timeline = parseVisual("timeline", JSON.stringify({ items: [{ time: "1", title: "a" }, { title: "no time" }, { time: "2", title: "b" }] }));
  assert.ok(timeline?.kind === "timeline");
  assert.deepEqual(timeline.items.map((item) => item.title), ["a", "b"]);
});

test("封面只认站点 /img/ 与图片代理放行的主机，不合格只丢图不丢条目", () => {
  const key = `${"a".repeat(64)}.webp`;
  const visual = parseVisual(
    "media",
    JSON.stringify({
      items: [
        { title: "ok", image: `/img/${key}`, url: "https://music.apple.com/x" },
        { title: "apple", image: "https://is1-ssl.mzstatic.com/image/thumb/x/{w}x{h}bb.jpg" },
        { title: "leak", image: "https://evil.example/c.png?q=secret", url: "javascript:alert(1)" },
      ],
    }),
  );
  assert.ok(visual?.kind === "media");
  assert.deepEqual(
    visual.items.map((item) => [item.image ?? null, item.url ?? null]),
    [
      [`/img/${key}`, "https://music.apple.com/x"],
      ["https://is1-ssl.mzstatic.com/image/thumb/x/{w}x{h}bb.jpg", null],
      [null, null],
    ],
  );
});

test("坐标刻度取整，含 0", () => {
  assert.deepEqual(niceTicks(0, 12.5), [0, 5, 10, 15]);
  assert.deepEqual(niceTicks(-3, 7), [-5, -2.5, 0, 2.5, 5, 7.5]);
  assert.deepEqual(niceTicks(0, 0), [0, 0.25, 0.5, 0.75, 1]);
});

test("数字按 en-US 分组，单位跟在后面", () => {
  assert.equal(formatVisualNumber(12.5, "h"), "12.5 h");
  assert.equal(formatVisualNumber(42, "%"), "42%");
  assert.equal(formatVisualNumber(1_234_567, undefined, true), "1.2M");
  assert.equal(formatVisualNumber(1234), "1,234");
});

test("写到一半的图示 JSON 按写完的条目先画", () => {
  const timeline = '{"title":"Week","items":[{"time":"Mon","title":"A"},{"time":"Tue","title":"B"},{"time":"We';
  const partial = parsePartialVisual("timeline", timeline);
  assert.ok(partial?.kind === "timeline");
  assert.deepEqual(partial.items.map((item) => item.title), ["A", "B"]);
  assert.equal(parsePartialVisual("timeline", '{"title":"Week","items":[{"time":"Mon","ti'), null);
  assert.equal(parsePartialVisual("stats", '{"items":[{"label":"a \\"q\\" }","value":"1"},{"lab')?.kind, "stats");
  assert.ok(parsePartialVisual("chart", '{"type":"bar","labels":["a","b"],"series":[{"name":"n","values":[1,2]}'));
});

test("标签之间的逗号写在重复段开头：空字符串夹着制表符再长也不卡住", () => {
  const spaced = parsePartialVisual("chart", '{"type":"line","labels":[ "10-06" , "10-07" , "10-08" ]');
  assert.ok(spaced?.kind === "chart");
  assert.deepEqual(spaced.labels, ["10-06", "10-07", "10-08"]);
  const escaped = parsePartialVisual("chart", '{"type":"bar","labels":["a\\"b","c\\\\d"]');
  assert.ok(escaped?.kind === "chart");
  assert.deepEqual(escaped.labels, ['a"b', "c\\d"]);
  const trailed = parsePartialVisual("chart", '{"type":"bar","labels":["a","b"],');
  assert.ok(trailed?.kind === "chart");
  assert.deepEqual(trailed.labels, ["a", "b"]);
  const attack = `{"type":"bar","labels":[""${"\t\"\"".repeat(28)}`;
  const started = performance.now();
  assert.equal(parsePartialVisual("chart", attack), null);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 100, `闭合判断用了 ${elapsed.toFixed(0)}ms`);
});

test("图表等标签写完先出坐标框，数据按写完的数逐个补上，写到半截的数不画", () => {
  assert.equal(parsePartialVisual("chart", '{"type":"line","title":"Tokens","labels":["10-06","10-07"'), null);
  const frame = parsePartialVisual("chart", '{"type":"line","title":"Tokens","labels":["10-06","10-07","10-08"]');
  assert.ok(frame?.kind === "chart");
  assert.deepEqual([frame.labels.length, frame.series], [3, []]);
  const growing = parsePartialVisual("chart", '{"type":"line","labels":["10-06","10-07","10-08"],"series":[{"name":"Tokens","values":[2.5,4.1,4');
  assert.ok(growing?.kind === "chart");
  assert.deepEqual(growing.series, [{ name: "Tokens", values: [2.5, 4.1] }]);
  assert.equal(parseVisual("chart", '{"type":"line","labels":["a","b"],"series":[{"name":"n","values":[1]}]}'), null);
});

test("条目写到字符串中间时文字逐字长；图表与媒体不画半截字符串，停在数字半截也不补成错数", () => {
  const growing = parsePartialVisual("timeline", '{"items":[{"time":"Mon","title":"A"},{"time":"Tue","title":"Launch","text":"Shipped the fir');
  assert.ok(growing?.kind === "timeline");
  assert.deepEqual(growing.items.map((item) => [item.title, item.text ?? null]), [["A", null], ["Launch", "Shipped the fir"]]);
  const titling = parsePartialVisual("timeline", '{"items":[{"time":"Mon","title":"Lau\n');
  assert.ok(titling?.kind === "timeline");
  assert.equal(titling.items[0].title, "Lau");
  assert.equal(parsePartialVisual("timeline", '{"items":[{"time":"Mon","title":"a\\'), null);
  const media = parsePartialVisual("media", '{"items":[{"title":"A"},{"title":"B","image":"https://is1-ssl.mzstatic.com/ima');
  assert.ok(media?.kind === "media");
  assert.deepEqual(media.items.map((item) => [item.title, item.image ?? null]), [["A", null], ["B", null]]);
  const chart = parsePartialVisual("chart", '{"type":"bar","labels":["a"],"series":[{"name":"n","values":[12');
  assert.ok(chart?.kind === "chart");
  assert.deepEqual(chart.series, [{ name: "n", values: [] }]);
});

test("流式解析随输出只增不减：写到键名、冒号、数字半截时正在写的条目不消失", () => {
  const source = '{"items":[{"label":"Mac","value":"Chrome","note":"Homepage"},{"label":"PS5","value":"离线","note":"约 1.5 小时前"},{"label":"Steps","value":1234},{"label":"End","value":"x"}],"summary":{"label":"结论","value":"深夜","tone":"good"}}';
  let shown = 0;
  let summary = false;
  for (let end = 1; end <= source.length; end++) {
    const visual = parsePartialVisual("stats", `${source.slice(0, end)}\n`);
    const count = visual?.kind === "stats" ? visual.items.length : 0;
    assert.ok(count >= shown, `第 ${end} 个字符处条目从 ${shown} 掉到 ${count}`);
    shown = count;
    const hasSummary = visual?.kind === "stats" && visual.summary !== undefined;
    assert.ok(hasSummary || !summary, `第 ${end} 个字符处结论消失`);
    summary = hasSummary;
  }
  assert.equal(shown, 4);
  const steps = parsePartialVisual("stats", '{"items":[{"label":"Steps","value":12');
  assert.equal(steps, null);
});

test("回复结束后漏写末尾括号的图示照画，中间括号对不上、停在字符串里的仍退回代码", () => {
  const missingOuter = '{"items":[{"label":"Mac 前台窗口","value":"Chrome","note":"LYJW\'s Homepage"},{"label":"PlayStation","value":"离线"}]\n\n';
  const stats = parseVisual("stats", missingOuter);
  assert.ok(stats?.kind === "stats");
  assert.equal(stats.items.length, 2);
  assert.ok(parseVisual("timeline", '{"items":[{"time":"1","title":"a"}'));
  assert.equal(parseVisual("stats", '{"items":[{"label":"a","value":"b"}}'), null);
  assert.equal(parseVisual("stats", '{"items":[{"label":"a","value":"b'), null);
  assert.equal(parseVisual("chart", '{"type":"bar","labels":["a"],"series":[{"name":"n","values":[1'), null);
});

test("结构图画不了的连线只丢那一条、重复 id 的节点只丢后一个，写到一半时先画已写完的层", () => {
  const layers = [
    { nodes: [{ id: "a", label: "A" }] },
    { nodes: [{ id: "b", label: "B" }] },
    { nodes: [{ id: "c", label: "C" }] },
  ];
  const diagram = (edges: unknown, nodes: unknown = layers) => parseVisual("diagram", JSON.stringify({ layers: nodes, edges }));
  assert.ok(diagram([{ from: "a", to: "b" }, { from: "c", to: "b", label: "back" }]));
  assert.ok(diagram(undefined));
  const edgesOf = (edges: unknown) => {
    const visual = diagram(edges);
    return visual?.kind === "diagram" ? visual.edges.map((edge) => `${edge.from}-${edge.to}`) : null;
  };
  assert.deepEqual(edgesOf([{ from: "a", to: "c" }, { from: "a", to: "b" }]), ["a-b"]);
  assert.deepEqual(edgesOf([{ from: "a", to: "a" }]), []);
  assert.deepEqual(edgesOf([{ from: "a", to: "x" }, "oops"]), []);
  const duplicate = diagram([], [{ nodes: [{ id: "a", label: "A" }] }, { nodes: [{ id: "a", label: "B" }, { id: "b", label: "B" }] }]);
  assert.ok(duplicate?.kind === "diagram");
  assert.deepEqual(duplicate.layers.map((layer) => layer.nodes.map((node) => node.label)), [["A"], ["B"]]);
  const sameLayer = diagram(
    [{ from: "a", to: "b" }, { from: "b", to: "b2" }],
    [{ nodes: [{ id: "a", label: "A" }] }, { nodes: [{ id: "b", label: "B" }, { id: "b2", label: "B2" }] }],
  );
  assert.ok(sameLayer?.kind === "diagram");
  assert.deepEqual(sameLayer.edges, [{ from: "a", to: "b" }]);
  const crowded = diagram([...Array.from({ length: GOD_CHAT_VISUAL_LIMITS.diagramEdges }, () => ({ from: "a", to: "a" })), { from: "a", to: "b" }]);
  assert.ok(crowded?.kind === "diagram");
  assert.deepEqual(crowded.edges, [{ from: "a", to: "b" }]);
  const gapped = diagram([{ from: "a", to: "c" }], [{ nodes: [{ id: "a", label: "A" }] }, { nodes: [{ label: "no id" }] }, { nodes: [{ id: "c", label: "C" }] }]);
  assert.ok(gapped?.kind === "diagram");
  assert.equal(gapped.layers.length, 2);
  assert.deepEqual(gapped.edges, [{ from: "a", to: "c" }]);
  const partial = parsePartialVisual("diagram", '{"layers":[{"nodes":[{"id":"a","label":"A"}]},{"nodes":[{"id":"b","lab');
  assert.ok(partial?.kind === "diagram");
  assert.deepEqual(partial.layers.map((layer) => layer.nodes.map((node) => node.id)), [["a"]]);
});
