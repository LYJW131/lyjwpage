import assert from "node:assert/strict";
import test from "node:test";

import {
  THEME_STORAGE_KEY,
  applyThemeToRoot,
  parseThemeChoice,
  resolveTheme,
  themeBootScript,
  themeMatchesRoot,
  type ThemeChoice,
} from "./theme.ts";

function fakeRoot(initialClasses: string[] = []) {
  const classes = new Set(initialClasses);
  return {
    classes,
    classList: {
      add: (...tokens: string[]) => tokens.forEach((token) => classes.add(token)),
      remove: (...tokens: string[]) => tokens.forEach((token) => classes.delete(token)),
      contains: (token: string) => classes.has(token),
    },
    dataset: {} as Record<string, string | undefined>,
    style: { colorScheme: "" },
  };
}

function withGlobals(overrides: Record<string, unknown>, run: () => void) {
  const saved = Object.keys(overrides).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(overrides)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  try {
    run();
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
}

function runBootScript(stored: string | null | "throws", systemDark: boolean, root = fakeRoot()) {
  withGlobals(
    {
      document: { documentElement: root },
      localStorage: {
        getItem: (key: string) => {
          assert.equal(key, THEME_STORAGE_KEY);
          if (stored === "throws") throw new Error("blocked");
          return stored;
        },
      },
      matchMedia: (query: string) => {
        assert.equal(query, "(prefers-color-scheme: dark)");
        return { matches: systemDark };
      },
    },
    () => new Function(themeBootScript())(),
  );
  return root;
}

test("存储值只认 light / dark，其余（含缺失）都是 system", () => {
  assert.equal(parseThemeChoice("light"), "light");
  assert.equal(parseThemeChoice("dark"), "dark");
  assert.equal(parseThemeChoice("system"), "system");
  for (const bad of [null, undefined, "", "Dark", "auto"]) assert.equal(parseThemeChoice(bad), "system");
});

test("system 跟随系统偏好，显式选择不受系统影响", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
});

test("首屏脚本与运行时 applyThemeToRoot 对同一输入落到同一份根节点状态", () => {
  const stored: Array<string | null | "throws"> = ["light", "dark", "system", null, "bogus", "throws"];
  for (const value of stored) {
    for (const systemDark of [true, false]) {
      const booted = runBootScript(value, systemDark, fakeRoot(["light", "h-full"]));
      const choice: ThemeChoice = value === "throws" ? "system" : parseThemeChoice(value);
      const applied = fakeRoot(["light", "h-full"]);
      applyThemeToRoot(applied, choice, systemDark);
      assert.deepEqual([...booted.classes].sort(), [...applied.classes].sort(), `${value}/${systemDark}`);
      assert.equal(booted.dataset.themeChoice, applied.dataset.themeChoice);
      assert.equal(booted.style.colorScheme, applied.style.colorScheme);
      assert.ok(themeMatchesRoot(booted, choice, systemDark));
    }
  }
});

test("根节点状态已一致时 themeMatchesRoot 为真，任一项不同为假；无关 class 保留", () => {
  const root = fakeRoot(["h-full"]);
  applyThemeToRoot(root, "dark", false);
  assert.deepEqual([...root.classes].sort(), ["dark", "h-full"]);
  assert.ok(themeMatchesRoot(root, "dark", true));
  assert.ok(!themeMatchesRoot(root, "light", true));
  assert.ok(!themeMatchesRoot(root, "system", false));
  root.style.colorScheme = "light";
  assert.ok(!themeMatchesRoot(root, "dark", true));
  applyThemeToRoot(root, "system", false);
  assert.ok(root.classes.has("light") && !root.classes.has("dark"));
  assert.ok(themeMatchesRoot(root, "system", false));
  assert.ok(!themeMatchesRoot(root, "system", true));
});
