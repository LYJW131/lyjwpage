import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";

import { deferModulePreloads } from "@/lib/defer-module-preloads";

const preloadA = '<link rel="modulepreload" href="/assets/entry.client-A.js"/>';
const preloadB = '<link rel="modulepreload" href="/assets/page-B.js" crossorigin=""/>';
const lowA = '<link rel="modulepreload" href="/assets/entry.client-A.js" fetchpriority="low"/>';
const lowB = '<link rel="modulepreload" href="/assets/page-B.js" crossorigin="" fetchpriority="low"/>';

test("head 里的 modulepreload 按原顺序挪到 </body> 前并降为低优先级，其余不动", () => {
  const html = `<html><head><link rel="stylesheet" href="/assets/root.css"/>${preloadA}<title>x</title>${preloadB}</head><body><main>hi</main><script type="module">import("/a.js")</script></body></html>`;
  assert.equal(
    deferModulePreloads(html),
    `<html><head><link rel="stylesheet" href="/assets/root.css"/><title>x</title></head><body><main>hi</main><script type="module">import("/a.js")</script>${lowA}${lowB}</body></html>`,
  );
});

test("body 里本来就有的 modulepreload 留在原处", () => {
  const html = `<html><head></head><body>${preloadA}</body></html>`;
  assert.equal(deferModulePreloads(html), html);
});

test("缺 </head> 或 </body> 时原样返回", () => {
  assert.equal(deferModulePreloads(`<head>${preloadA}`), `<head>${preloadA}`);
  assert.equal(deferModulePreloads(`<head>${preloadA}</head>`), `<head>${preloadA}</head>`);
});

test("已写明 fetchpriority 的 modulepreload 不再改", () => {
  const explicit = '<link rel="modulepreload" href="/assets/a.js" fetchPriority="high">';
  assert.equal(deferModulePreloads(`<html><head>${explicit}</head><body></body></html>`), `<html><head></head><body>${explicit}</body></html>`);
});

type Element = {
  tagName: string;
  attributes: { name: string; value: string }[];
  textContent: string;
  setAttribute: (name: string, value: string) => void;
};

function element(tagName: string, attributes: Element["attributes"] = [], textContent = ""): Element {
  return {
    tagName,
    attributes,
    textContent,
    setAttribute(name, value) { this.attributes.push({ name, value }); },
  };
}

function parsedElements(html: string): Element[] {
  return parseFragment(html).childNodes
    .filter((node): node is DefaultTreeAdapterTypes.Element => "tagName" in node)
    .map((node) => element(
      node.tagName,
      node.attrs.map(({ name, value }) => ({ name, value })),
      node.childNodes.map((child) => "value" in child ? child.value : "").join(""),
    ));
}

function markup(elements: Element[]) {
  return elements.map(({ tagName, attributes, textContent }) => ({ tagName, attributes, textContent }));
}

function startup({
  hidden = false,
  entryTypes = null,
  module = '<script type="module" async="">import "/assets/entry.client-A.js";</script>',
  preloads = preloadA + preloadB,
}: { hidden?: boolean; entryTypes?: string[] | null; module?: string; preloads?: string } = {}) {
  const html = deferModulePreloads(`<html><head>${preloads}</head><body><main>SSR</main>${module}</body></html>`);
  const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  const nodes = parsedElements(body);
  const bootstrap = nodes.find((node) => node.tagName === "script");
  assert.ok(bootstrap);
  assert.ok(!bootstrap.attributes.some(({ name, value }) => name === "type" && value === "module"), "入口模块应由经典脚本调度启动");
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  const timerDelays: number[] = [];
  const listeners = new Map<string, () => void>();
  const inserted: Element[] = [];
  const events: string[] = [];
  let replacement: Element | null = null;
  let nextFrame = 0;
  let nextTimer = 0;
  let observerCallback: (() => void) | null = null;
  const document = {
    currentScript: {
      replaceWith(script: Element) {
        events.push("module");
        assert.equal(replacement, null);
        replacement = script;
      },
    },
    visibilityState: hidden ? "hidden" : "visible",
    addEventListener(name: string, callback: () => void) { listeners.set(name, callback); },
    removeEventListener(name: string, callback: () => void) {
      assert.equal(listeners.get(name), callback);
      listeners.delete(name);
    },
    body: {
      appendChild(fragment: { nodes: Element[] }) {
        events.push("preloads");
        inserted.push(...fragment.nodes);
      },
    },
    createElement(name: string) {
      if (name !== "template") return element(name);
      let contents: Element[] = [];
      return {
        set innerHTML(markup: string) { contents = parsedElements(markup); },
        get content() { return { nodes: contents, firstElementChild: contents[0] }; },
      };
    },
  };
  vm.runInNewContext(bootstrap.textContent, {
    document,
    performance: { getEntriesByName: () => [] },
    ...(entryTypes ? {
      PerformanceObserver: class {
        static supportedEntryTypes = entryTypes;
        constructor(callback: () => void) { observerCallback = callback; }
        observe() {}
        disconnect() {}
      },
    } : {}),
    requestAnimationFrame(callback: () => void) {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number) { frames.delete(id); },
    setTimeout(callback: () => void, delay: number) {
      const id = ++nextTimer;
      timers.set(id, callback);
      timerDelays.push(delay);
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
  });
  return {
    html, bootstrap, frames, timers, timerDelays, listeners, inserted, events,
    frameCount() { return nextFrame; },
    replacement() { return replacement; },
    lcpEntry() { observerCallback?.(); },
    frame() {
      const [id, callback] = frames.entries().next().value ?? [];
      assert.ok(id);
      assert.ok(callback);
      frames.delete(id);
      callback();
    },
    task() {
      const [id, callback] = timers.entries().next().value ?? [];
      assert.ok(id);
      assert.ok(callback);
      timers.delete(id);
      callback();
    },
    hide() {
      document.visibilityState = "hidden";
      listeners.get("visibilitychange")?.();
    },
  };
}

test("次帧后只排一个零延时任务，成批激活预加载并原位启动模块，旧回调不重复启动", () => {
  const run = startup();
  assert.equal(run.html.match(/<link/g), null);
  assert.ok(!run.bootstrap.attributes.some(({ name }) => name === "type"));
  assert.equal(run.replacement(), null);
  assert.deepEqual(run.inserted, []);
  const firstFrame = [...run.frames.values()][0];
  assert.ok(firstFrame);
  run.frame();
  assert.equal(run.replacement(), null);
  assert.equal(run.frames.size, 1);
  assert.equal(run.frameCount(), 2);
  assert.deepEqual(run.timerDelays, []);
  assert.equal(run.timers.size, 0);
  firstFrame();
  assert.equal(run.frames.size, 1);
  const secondFrame = [...run.frames.values()][0];
  assert.ok(secondFrame);
  run.frame();
  assert.equal(run.frames.size, 0);
  assert.deepEqual(run.timerDelays, [0]);
  assert.equal(run.timers.size, 1);
  const queuedTask = [...run.timers.values()][0];
  assert.ok(queuedTask);
  run.task();
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.deepEqual(markup(run.inserted), markup(parsedElements(lowA + lowB)));
  assert.equal(run.replacement()?.textContent, 'import "/assets/entry.client-A.js";');
  assert.equal(run.listeners.size, 0);
  assert.equal(run.frames.size, 0);
  assert.equal(run.timers.size, 0);
  firstFrame();
  secondFrame();
  queuedTask();
  run.hide();
  assert.deepEqual(run.timerDelays, [0]);
  assert.deepEqual(run.events, ["preloads", "module"]);
});

test("LCP 观察可用但不发条目时，入口由上限任务兜底启动", () => {
  const run = startup({ entryTypes: ["largest-contentful-paint"] });
  assert.deepEqual(run.events, []);
  assert.equal(run.frames.size, 0);
  assert.deepEqual(run.timerDelays, [3000]);
  assert.equal(run.timers.size, 1);
  run.task();
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.equal(run.frames.size, 0);
  assert.equal(run.timers.size, 0);
});

test("支持其它条目类型但不支持 LCP 时走两帧路径，不排上限任务", () => {
  const run = startup({ entryTypes: ["paint", "element"] });
  assert.equal(run.frames.size, 1);
  assert.deepEqual(run.timerDelays, []);
  run.frame();
  run.frame();
  run.task();
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.equal(run.frames.size, 0);
  assert.equal(run.timers.size, 0);
});

test("收到 LCP 条目后下一帧启动，重复条目与转入后台都不重复启动", () => {
  const run = startup({ entryTypes: ["largest-contentful-paint"] });
  assert.equal(run.frames.size, 0);
  run.lcpEntry();
  run.lcpEntry();
  assert.deepEqual(run.events, []);
  assert.equal(run.frames.size, 2);
  run.frame();
  run.frame();
  assert.equal(run.timers.size, 3);
  assert.deepEqual(run.timerDelays, [3000, 0, 0]);
  const [cap, startTask, staleTask] = [...run.timers.values()];
  startTask();
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.equal(run.frames.size, 0);
  cap();
  staleTask();
  run.lcpEntry();
  run.hide();
  assert.deepEqual(run.events, ["preloads", "module"]);
});

test("初始后台无需等动画帧，预加载和模块只启动一次", () => {
  const run = startup({ hidden: true });
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.equal(run.frames.size, 0);
  assert.equal(run.timers.size, 0);
  assert.deepEqual(run.timerDelays, []);
  assert.equal(run.listeners.size, 0);
  run.hide();
  assert.deepEqual(run.events, ["preloads", "module"]);
});

test("首帧前或首帧后任务前转入后台会立即启动，取消后的旧回调不重复启动", () => {
  for (const afterFirstFrame of [false, true]) {
    const run = startup();
    const queuedFrame = [...run.frames.values()][0];
    assert.ok(queuedFrame);
    if (afterFirstFrame) run.frame();
    const queued = [queuedFrame, ...run.frames.values(), ...run.timers.values()];
    run.hide();
    assert.deepEqual(run.events, ["preloads", "module"]);
    assert.equal(run.frames.size, 0);
    assert.equal(run.timers.size, 0);
    assert.equal(run.listeners.size, 0);
    for (const callback of queued) callback();
    assert.equal(run.frames.size, 0);
    assert.equal(run.timers.size, 0);
    assert.equal(run.frameCount(), afterFirstFrame ? 2 : 1);
    assert.deepEqual(run.timerDelays, []);
    assert.deepEqual(run.events, ["preloads", "module"]);
  }
});

test("保留 nonce、crossorigin、显式 fetchpriority 与入口脚本文本，不让内嵌标签逃逸 bootstrap", () => {
  const module = `<script nonce="abc&amp;123" crossorigin="anonymous" fetchpriority="high" async type='module'>const text = "<script><!--"; import "/entry.js";</script>`;
  const preloads = '<link rel="modulepreload" href="/x.js?a=1&amp;b=2" crossorigin="use-credentials" fetchpriority="high" nonce="xyz"/>';
  const run = startup({ module, preloads });
  assert.equal(run.bootstrap.attributes.find(({ name }) => name === "nonce")?.value, "abc&123");
  assert.equal((run.html.match(/<\/script>/g) ?? []).length, 1);
  run.frame();
  run.frame();
  run.task();
  assert.deepEqual(run.replacement()?.attributes, parsedElements(module)[0].attributes);
  assert.equal(run.replacement()?.textContent, parsedElements(module)[0].textContent);
  assert.deepEqual(markup(run.inserted), markup(parsedElements(preloads)));
});

test("没有 head 预加载时入口仍等首帧后的任务，普通脚本和外部模块脚本保持原样", () => {
  const run = startup({ preloads: "" });
  assert.equal(run.replacement(), null);
  run.frame();
  run.frame();
  run.task();
  assert.ok(run.replacement());
  for (const script of [
    '<script async>window.started=true</script>',
    '<script type="module" async src="/entry.js"></script>',
    '<script data-type="module" async>window.started=true</script>',
  ]) {
    const html = `<html><head>${preloadA}</head><body>${script}</body></html>`;
    assert.equal(deferModulePreloads(html), `<html><head></head><body>${script}${lowA}</body></html>`);
  }
});
