import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSET_RECOVERY_COOLDOWN_MS,
  ASSET_RECOVERY_FETCH_TIMEOUT_MS,
  ASSET_RECOVERY_KEY,
  assetRecoveryScript,
} from "./asset-recovery-boot.ts";

type Listener = (event: { target: unknown }) => void;

type FakeLink = { tagName: "LINK"; rel: string; href: string; sheet: object | null };

function harness(options: { commit?: string; stored?: string | null; online?: boolean; links?: FakeLink[]; now?: number } = {}) {
  const listeners: Record<string, Listener[]> = {};
  const storage = new Map<string, string>();
  if (options.stored) storage.set(ASSET_RECOVERY_KEY, options.stored);
  const fetches: { url: string; init: RequestInit }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let reloads = 0;
  let settle: () => void = () => {};
  const commit = options.commit ?? "abc1234";
  const run = new Function(
    "document",
    "location",
    "navigator",
    "sessionStorage",
    "fetch",
    "setTimeout",
    "clearTimeout",
    "addEventListener",
    "Date",
    "URL",
    assetRecoveryScript(),
  );
  run(
    {
      querySelector: (selector: string) =>
        selector === 'meta[name="build-commit"]' ? { getAttribute: () => commit } : null,
      querySelectorAll: () => options.links ?? [],
    },
    {
      href: "https://lyjw.me/",
      origin: "https://lyjw.me",
      reload: () => {
        reloads += 1;
      },
    },
    { onLine: options.online ?? true },
    {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    (url: string, init: RequestInit) => {
      fetches.push({ url, init });
      return new Promise<{ text(): Promise<string> }>((resolve) => {
        settle = () => resolve({ text: async () => "" });
      });
    },
    (fn: () => void, ms: number) => timers.push({ fn, ms }),
    () => {},
    (type: string, fn: Listener) => {
      (listeners[type] ??= []).push(fn);
    },
    { now: () => options.now ?? 1_000_000 },
    URL,
  );
  const fire = (type: string, target: unknown) => listeners[type]?.forEach((fn) => fn({ target }));
  return {
    fire,
    storage,
    fetches,
    timers,
    reloads: () => reloads,
    settle: async () => {
      settle();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const link = (rel: string, href: string, sheet: object | null = null): FakeLink => ({ tagName: "LINK", rel, href, sheet });

test("生成的内联脚本是合法 JS，且不含 </script>", () => {
  const script = assetRecoveryScript();
  assert.doesNotThrow(() => new Function(script));
  assert.ok(!script.toLowerCase().includes("</script"));
});

test("站内样式表 404：先强制重取这页再刷新一次，并按版本记账", async () => {
  const h = harness();
  h.fire("error", link("stylesheet", "/assets/root-old.css"));
  assert.deepEqual(h.fetches.map((f) => [f.url, f.init.cache]), [["https://lyjw.me/", "reload"]]);
  assert.equal(h.reloads(), 0, "缓存换新之前不刷新");
  await h.settle();
  assert.equal(h.reloads(), 1);
  assert.deepEqual(JSON.parse(h.storage.get(ASSET_RECOVERY_KEY)!), { c: "abc1234", t: 1_000_000 });
  h.fire("error", link("modulepreload", "/assets/page-old.js"));
  assert.equal(h.fetches.length, 1, "同一页只自救一次");
});

test("重取超时也照样刷新，且晚到的响应不会再刷第二次", async () => {
  const h = harness();
  h.fire("error", link("modulepreload", "/assets/page-old.js"));
  assert.equal(h.timers[0]?.ms, ASSET_RECOVERY_FETCH_TIMEOUT_MS);
  h.timers[0]!.fn();
  assert.equal(h.reloads(), 1);
  await h.settle();
  assert.equal(h.reloads(), 1);
});

test("load 时样式表没挂上（请求断在半路、没有 error 事件）也自救", () => {
  const h = harness({ links: [link("stylesheet", "/assets/root-ok.css", {}), link("stylesheet", "/assets/root-old.css")] });
  h.fire("load", null);
  assert.equal(h.fetches.length, 1);
});

test("同一版本冷却期内刷回来还是坏的，就停手不刷成环", () => {
  const stored = JSON.stringify({ c: "abc1234", t: 1_000_000 - ASSET_RECOVERY_COOLDOWN_MS + 1 });
  const h = harness({ stored });
  h.fire("error", link("stylesheet", "/assets/root-old.css"));
  assert.equal(h.fetches.length, 0);
});

test("刷回来换了版本仍坏、或冷却已过，再救一次", () => {
  const otherCommit = harness({ stored: JSON.stringify({ c: "old0000", t: 1_000_000 }) });
  otherCommit.fire("error", link("stylesheet", "/assets/root-new.css"));
  assert.equal(otherCommit.fetches.length, 1);
  const expired = harness({ stored: JSON.stringify({ c: "abc1234", t: 1_000_000 - ASSET_RECOVERY_COOLDOWN_MS }) });
  expired.fire("error", link("stylesheet", "/assets/root-old.css"));
  assert.equal(expired.fetches.length, 1);
});

test("模块脚本的依赖图取不到（入口或路由模块 404）也自救", () => {
  const inline = harness();
  inline.fire("error", { tagName: "SCRIPT", type: "module", src: "" });
  assert.equal(inline.fetches.length, 1);
  const external = harness();
  external.fire("error", { tagName: "SCRIPT", type: "module", src: "https://lyjw.me/assets/entry.client-old.js" });
  assert.equal(external.fetches.length, 1);
});

test("站外资源（含站外的 /assets/）、普通脚本、图片和离线时不动", () => {
  const h = harness();
  h.fire("error", link("stylesheet", "https://fonts.example/a.css"));
  h.fire("error", link("stylesheet", "https://cdn.example/assets/theme.css"));
  h.fire("error", { tagName: "SCRIPT", type: "module", src: "https://cdn.example/assets/x.js" });
  h.fire("error", { tagName: "SCRIPT", type: "", src: "/assets/classic.js" });
  h.fire("error", link("preload", "/assets/font.woff2"));
  h.fire("error", { tagName: "IMG", rel: "", href: "/assets/x.png" });
  assert.equal(h.fetches.length, 0);
  const offline = harness({ online: false });
  offline.fire("error", link("stylesheet", "/assets/root-old.css"));
  assert.equal(offline.fetches.length, 0);
});
