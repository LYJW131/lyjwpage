import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PAGE_TOKENS } from "./oauth/consent-page.ts";

const THEME = readFileSync(new URL("../../../src/app/styles/theme.css", import.meta.url), "utf8");

function block(selector: string): Map<string, string> {
  const start = THEME.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `theme.css 里找不到 ${selector}`);
  const body = THEME.slice(start, THEME.indexOf("\n}", start));
  return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

test("同意页的色值跟站点主题一致", () => {
  const light = block(":root");
  const dark = block(".dark");
  for (const [name, value] of Object.entries(PAGE_TOKENS.light)) assert.equal(value, light.get(name), `浅色 --${name}`);
  for (const [name, value] of Object.entries(PAGE_TOKENS.dark)) {
    const expected = dark.get(name) ?? light.get(name);
    assert.equal(value, expected?.startsWith("var(--") ? light.get(expected.slice(6, -1)) : expected, `深色 --${name}`);
  }
});
