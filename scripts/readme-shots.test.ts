import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { byLabel, jsLiteral, SHOTS } from "./readme-shots.ts";

const find = (name: string) => SHOTS.find((shot) => shot.name === name)?.find;

test("现有截图卡片的定位表达式不变", () => {
  assert.equal(find("now-watching"), 'document.getElementById("now-watching")');
  assert.equal(find("playstation-trophies"), 'document.getElementById("playing")');
  assert.equal(find("site-status"), 'document.getElementById("site-status")');
  assert.equal(find("powerbank"), `[...document.querySelectorAll(".paper-card")].find((card) => card.querySelector(".label-mono")?.textContent.trim() === ${jsLiteral("Power Bank")})`);
  assert.equal(find("pulse-detail"), `[...document.querySelectorAll(".paper-card")].find((card) => card.querySelector(".label-mono")?.textContent.trim() === ${jsLiteral("Pulse")})`);
});

test("不含截断字符的字符串与 JSON.stringify 相同，且求值后是原值", () => {
  for (const value of ["Power Bank", "Pulse", "now-watching", "", "line\n\t\r\b\f\0\"'\\"]) {
    assert.equal(jsLiteral(value), JSON.stringify(value));
    assert.equal(vm.runInNewContext(jsLiteral(value)), value);
  }
});

test("标签里的 script 收尾与行分隔符写成 \\uXXXX，表达式仍按原文匹配", () => {
  const label = "say </script> \"hi\" \\\u2028\u2029 end";
  const literal = jsLiteral(label);
  assert.equal(/[<>/\u2028\u2029]/.test(literal), false);
  assert.equal(vm.runInNewContext(literal), label);

  const source = byLabel(label);
  assert.equal(source.includes("<"), false);
  assert.equal(source.includes("\u2028"), false);
  assert.equal(source.includes("\u2029"), false);
  assert.equal(source.includes(label), false);
  assert.equal([...source].filter((char) => char === ">").length, 1);
  const matched = vm.runInNewContext(`
    const label = ${literal};
    const hit = { querySelector: () => ({ textContent: label }) };
    const document = { querySelectorAll: () => [{ querySelector: () => ({ textContent: "Pulse" }) }, hit] };
    (${source}) === hit
  `);
  assert.equal(matched, true);
});
