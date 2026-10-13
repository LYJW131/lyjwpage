import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compare, scan, sortedBaseline, SPACING_SCALE } from "./design-scale-check.mjs";

const tokens = (text) => scan(text).map((hit) => `${hit.kind}:${hit.token}`);

test("阶梯内的间距、变体前缀和负外边距不算违规", () => {
  assert.deepEqual(tokens(`cn("p-4 lg:p-5 gap-3 -mx-2 px-2 space-y-1.5 hover:mt-0.5 m-auto px-px", ok && "gap-y-8")`), []);
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

test("带重要性后缀、行高修饰符或 length: 类型的违规也算", () => {
  assert.deepEqual(tokens(`"p-2.5! text-[13px]/4 text-[length:13px] !mt-3.5"`), [
    "spacing:p-2.5",
    "spacing:mt-3.5",
    "fontSize:text-[13px]",
    "fontSize:text-[length:13px]",
  ]);
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
