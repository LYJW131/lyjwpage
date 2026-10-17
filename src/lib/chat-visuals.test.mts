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

test("写到一半的图示 JSON 按写完的条目先画，图表要数据齐了才画", () => {
  const timeline = '{"title":"Week","items":[{"time":"Mon","title":"A"},{"time":"Tue","title":"B"},{"time":"We';
  const partial = parsePartialVisual("timeline", timeline);
  assert.ok(partial?.kind === "timeline");
  assert.deepEqual(partial.items.map((item) => item.title), ["A", "B"]);
  assert.equal(parsePartialVisual("timeline", '{"title":"Week","items":[{"time":"Mon","ti'), null);
  assert.equal(parsePartialVisual("stats", '{"items":[{"label":"a \\"q\\" }","value":"1"},{"lab')?.kind, "stats");
  assert.equal(parsePartialVisual("chart", '{"type":"bar","labels":["a","b"],"series":[{"name":"n","values":[1'), null);
  assert.ok(parsePartialVisual("chart", '{"type":"bar","labels":["a","b"],"series":[{"name":"n","values":[1,2]}'));
});

test("结构图画不了的连线只丢那一条、重复 id 的节点只丢后一个，写到一半时先画已写完的层", () => {
  const layers = [
    { nodes: [{ id: "a", label: "A" }] },
    { nodes: [{ id: "b", label: "B" }] },
    { nodes: [{ id: "c", label: "C" }] },
  ];
  const diagram = (edges: unknown, nodes = layers) => parseVisual("diagram", JSON.stringify({ layers: nodes, edges }));
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
  const partial = parsePartialVisual("diagram", '{"layers":[{"nodes":[{"id":"a","label":"A"}]},{"nodes":[{"id":"b","lab');
  assert.ok(partial?.kind === "diagram");
  assert.deepEqual(partial.layers.map((layer) => layer.nodes.map((node) => node.id)), [["a"]]);
});
