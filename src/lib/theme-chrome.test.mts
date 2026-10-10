import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  THEME_COLOR_DARK,
  THEME_COLOR_LIGHT,
  documentThemeBootScript,
  globalErrorThemeScript,
  themeColorFor,
} from "./theme-chrome.ts";

function runBoot(theme: string | null, prefersDark: boolean) {
  const store = new Map<string, string>();
  if (theme != null) store.set("theme", theme);
  const metas = [
    { content: THEME_COLOR_LIGHT, media: "(prefers-color-scheme: light)" },
    { content: THEME_COLOR_DARK, media: "(prefers-color-scheme: dark)" },
  ];
  const document = {
    documentElement: { dataset: {} as Record<string, string>, classList: { added: [] as string[], add(name: string) { this.added.push(name); } } },
    querySelectorAll() {
      return metas;
    },
  };
  const localStorage = {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
  };
  const matchMedia = () => ({ matches: prefersDark });
  const run = new Function("document", "localStorage", "matchMedia", documentThemeBootScript());
  run(document, localStorage, matchMedia);
  return { document, metas };
}

test("theme-color 十六进制是 globals.css 里 --background 的 sRGB，并与开放图纸色相同", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /:root\s*\{[^}]*--background:\s*oklch\(0\.94 0\.007 92\)/s);
  assert.match(css, /\.dark\s*\{[^}]*--background:\s*oklch\(0\.15 0\.008 85\)/s);
  const og = readFileSync(new URL("../app/opengraph-image.tsx", import.meta.url), "utf8");
  assert.match(og, new RegExp(`const PAPER = "${THEME_COLOR_LIGHT}"`));
  assert.equal(THEME_COLOR_LIGHT, "#edebe6");
  assert.equal(THEME_COLOR_DARK, "#0d0b08");
});

test("显式主题压过系统配色", () => {
  assert.equal(themeColorFor("dark", false), THEME_COLOR_DARK);
  assert.equal(themeColorFor("light", true), THEME_COLOR_LIGHT);
  assert.equal(themeColorFor("system", true), THEME_COLOR_DARK);
  assert.equal(themeColorFor(null, false), THEME_COLOR_LIGHT);
});

test("首屏脚本是合法 JS，并按已保存的主题改写全部 theme-color", () => {
  const script = documentThemeBootScript();
  assert.doesNotThrow(() => new Function(script));
  assert.equal(script.toLowerCase().includes("</script"), false);

  const forcedDark = runBoot("dark", false);
  assert.equal(forcedDark.document.documentElement.dataset.themeChoice, "dark");
  assert.deepEqual(forcedDark.metas.map((meta) => meta.content), [THEME_COLOR_DARK, THEME_COLOR_DARK]);

  const forcedLight = runBoot("light", true);
  assert.deepEqual(forcedLight.metas.map((meta) => meta.content), [THEME_COLOR_LIGHT, THEME_COLOR_LIGHT]);

  const systemDark = runBoot("system", true);
  assert.deepEqual(systemDark.metas.map((meta) => meta.content), [THEME_COLOR_DARK, THEME_COLOR_DARK]);
  assert.equal(systemDark.document.documentElement.dataset.heatmap, "tokens");
});

test("全局错误页脚本在深色选择下加上 dark，并写上对应的 theme-color", () => {
  const script = globalErrorThemeScript();
  assert.doesNotThrow(() => new Function(script));
  const metas = [{ content: "" }, { content: "" }];
  const document = {
    documentElement: { classList: { added: [] as string[], add(name: string) { this.added.push(name); } } },
    querySelectorAll() {
      return metas;
    },
  };
  new Function("document", "localStorage", "matchMedia", script)(
    document,
    { getItem: () => "dark" },
    () => ({ matches: false }),
  );
  assert.deepEqual(document.documentElement.classList.added, ["dark"]);
  assert.deepEqual(metas.map((meta) => meta.content), [THEME_COLOR_DARK, THEME_COLOR_DARK]);
});
