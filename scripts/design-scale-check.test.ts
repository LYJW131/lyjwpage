import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compare, scan, scanSource, sortedBaseline, SPACING_SCALE } from "./design-scale-check.ts";

const tokens = (text: string) => scan(text).map((hit) => `${hit.kind}:${hit.token}`);

test("阶梯内的间距、变体前缀和负外边距不算违规", () => {
  assert.deepEqual(tokens(`cn("p-4 lg:p-5 gap-3 -mx-2 px-2 space-y-1.5 m-auto px-px", ok && "gap-y-8")`), []);
});

test("半步、刻度外整数与任意值间距算违规", () => {
  assert.deepEqual(tokens(`className="py-2.5 lg:pl-4.5 gap-x-2.5 py-12 -mr-[3px]"`), [
    "spacing:py-2.5",
    "spacing:pl-4.5",
    "spacing:gap-x-2.5",
    "spacing:py-12",
    "spacing:-mr-[3px]",
  ]);
});

test("任意值字号与位移算违规，颜色类任意值不算", () => {
  assert.deepEqual(tokens(`"text-[10px] text-[0.6875rem] text-[var(--x)] text-[color:red] -translate-y-[3px] -translate-y-px"`), [
    "fontSize:text-[10px]",
    "fontSize:text-[0.6875rem]",
    "translate:-translate-y-[3px]",
  ]);
});

test("不在类名边界上的同形片段不算", () => {
  assert.deepEqual(tokens(`scroll-mt-12 size-3.5 h-2.5 w-[3px] data-p-2.5`), []);
});

test("自定义属性简写、calc 字号与不带轴的任意位移也算", () => {
  assert.deepEqual(
    tokens(`"p-(--pad) space-x-(--gap) text-[calc(1rem+1px)] text-[clamp(1rem,2vw,2rem)] text-[length:var(--size)] text-(length:--size) translate-[3px] -translate-y-(--offset) text-(--brand)"`),
    [
      "spacing:p-(--pad)",
      "spacing:space-x-(--gap)",
      "fontSize:text-[calc(1rem+1px)]",
      "fontSize:text-[clamp(1rem,2vw,2rem)]",
      "fontSize:text-[length:var(--size)]",
      "fontSize:text-(length:--size)",
      "translate:translate-[3px]",
      "translate:-translate-y-(--offset)",
    ],
  );
});

test("块方向逻辑间距 pbs / pbe / mbs / mbe 也算", () => {
  assert.deepEqual(tokens(`"pbs-2.5 mbe-12 pbs-4"`), ["spacing:pbs-2.5", "spacing:mbe-12", "margin:mbe-12"]);
});

test("带重要性后缀、行高修饰符或 length: 类型的违规也算", () => {
  assert.deepEqual(tokens(`"p-2.5! text-[13px]/4 text-[length:13px] !mt-3.5"`), [
    "spacing:p-2.5",
    "spacing:mt-3.5",
    "fontSize:text-[13px]",
    "fontSize:text-[length:13px]",
    "margin:mt-3.5",
  ]);
});

test("任意值圆角算违规，rounded-full 与被映射成 0 的具名圆角不算", () => {
  assert.deepEqual(tokens(`"rounded-[2px] rounded-t-[3px] rounded-(--r) rounded-md rounded-full -rounded-b-[1px]"`), [
    "radius:rounded-[2px]",
    "radius:rounded-t-[3px]",
    "radius:rounded-(--r)",
    "radius:-rounded-b-[1px]",
  ]);
});

test("子级竖向外边距算违规：mt/mb/my/m/mbs/mbe；归零、auto、横向与 scroll-mt 不算", () => {
  assert.deepEqual(tokens(`"mt-3 hover:mb-2 my-1.5 -mt-px m-4 mbs-2 mbe-6 mt-0 mb-0 mt-auto ml-2 mx-auto -mx-2 scroll-mt-12 mse-4"`), [
    "margin:mt-3",
    "margin:mb-2",
    "margin:my-1.5",
    "margin:-mt-px",
    "margin:m-4",
    "margin:mbs-2",
    "margin:mbe-6",
  ]);
});

test("裸 hex 与 oklch/rgb/hsl 色值算违规，token 引用与锚点/id 不算", () => {
  assert.deepEqual(
    tokens(`const C = "#f5c542"; fill="#FFE842" bg-[oklch(0.65_0.17_145)] style={{ color: "#fff6d5" }} "rgba(0,0,0,.5)" url(#paint0) href="#section" id="intro" `),
    ["rawColor:#f5c542", "rawColor:#FFE842", "rawColor:oklch(0.65_0.17_145)", "rawColor:#fff6d5", "rawColor:rgba(0,0,0,.5)"],
  );
});

test("3/4 位 hex 也算：任意值、SVG 属性、颜色属性上下文", () => {
  assert.deepEqual(
    tokens(`className="bg-[#f00] text-[#abc8]" stroke="#fff" stopColor="#000" `),
    ["rawColor:#f00", "rawColor:#abc8", "rawColor:#fff", "rawColor:#000"],
  );
});

test("3/4 位 hex 不误伤：#id 选择器、href 锚点、url(#…)、工单号", () => {
  assert.deepEqual(
    tokens(`document.querySelector("#abc") el.closest("#def") <a href="#abc"> url(#fff) location.hash = "#123" "see #123 for details" `),
    [],
  );
  // 全数字的 3/4 位（#000、#123）只在颜色属性上下文算，裸文本里像工单号不算
  assert.deepEqual(tokens(`"issue #123" stroke="#123" fill: "#4567" `), ["rawColor:#123", "rawColor:#4567"]);
});

test("注释里的类名与色值不进场（scanSource 先屏蔽注释）", () => {
  const hits = scanSource("src/lib/x.ts", `const a = "mt-3"; // TODO(#256) 之后改 mt-4\n/* p-9 #fff 注释里的都不算 */\nconst b = "gap-2.5";`);
  assert.deepEqual(hits.map((h) => `${h.kind}:${h.token}`), ["margin:mt-3", "spacing:gap-2.5"]);
});

test("按类名比较：换成另一个违规值算增加，变少只报 shrank", () => {
  const baseline = { "text-[10px]": 2, "py-2.5": 1 };
  const counts = { "text-[10px]": 1, "text-[9px]": 1, "py-2.5": 1 };
  assert.deepEqual(compare(baseline, counts), {
    grew: [{ token: "text-[9px]", before: 0, after: 1 }],
    shrank: [{ token: "text-[10px]", before: 2, after: 1 }],
  });
});

test("基线按类名排序", () => {
  assert.deepEqual(Object.keys(sortedBaseline({ "text-[9px]": 1, "gap-2.5": 2 })), ["gap-2.5", "text-[9px]"]);
});

test("SPACING_SCALE 与 DESIGN.md「Layout」的间距刻度表一致（另加 0 与 px）", () => {
  const design = readFileSync(new URL("../DESIGN.md", import.meta.url), "utf8");
  const layout = design.slice(design.indexOf("## Layout"), design.indexOf("\n## ", design.indexOf("## Layout") + 1));
  const documented = layout
    .split("\n")
    .filter((line) => /^\| `/.test(line))
    .flatMap((line) => [...line.split("|")[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  assert.deepEqual([...SPACING_SCALE].filter((v) => v !== "0" && v !== "px").sort(), documented.sort());
});
