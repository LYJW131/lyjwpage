import assert from "node:assert/strict";
import test from "node:test";

import { GOD_CHAT_VISUAL_EXAMPLES, GOD_CHAT_VISUAL_KINDS } from "@shared/god-chat";
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

test("结构图的连线只接相邻两层、id 不重复，写到一半时先画已写完的层", () => {
  const layers = [
    { nodes: [{ id: "a", label: "A" }] },
    { nodes: [{ id: "b", label: "B" }] },
    { nodes: [{ id: "c", label: "C" }] },
  ];
  const diagram = (edges: unknown, nodes = layers) => parseVisual("diagram", JSON.stringify({ layers: nodes, edges }));
  assert.ok(diagram([{ from: "a", to: "b" }, { from: "c", to: "b", label: "back" }]));
  assert.ok(diagram(undefined));
  assert.equal(diagram([{ from: "a", to: "c" }]), null);
  assert.equal(diagram([{ from: "a", to: "a" }]), null);
  assert.equal(diagram([{ from: "a", to: "x" }]), null);
  assert.equal(diagram([], [{ nodes: [{ id: "a", label: "A" }] }, { nodes: [{ id: "a", label: "B" }] }]), null);
  const partial = parsePartialVisual("diagram", '{"layers":[{"nodes":[{"id":"a","label":"A"}]},{"nodes":[{"id":"b","lab');
  assert.ok(partial?.kind === "diagram");
  assert.deepEqual(partial.layers.map((layer) => layer.nodes.map((node) => node.id)), [["a"]]);
});
