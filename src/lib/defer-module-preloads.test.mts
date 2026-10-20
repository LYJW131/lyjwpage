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
  paintSupport = false,
  existingPaint = false,
  module = '<script type="module" async="">import "/assets/entry.client-A.js";</script>',
  preloads = preloadA + preloadB,
}: { hidden?: boolean; paintSupport?: boolean | "absent"; existingPaint?: boolean; module?: string; preloads?: string } = {}) {
  const html = deferModulePreloads(`<html><head>${preloads}</head><body><main>SSR</main>${module}</body></html>`);
  const body = html.slice(html.indexOf("<body>") + 6, html.lastIndexOf("</body>"));
  const nodes = parsedElements(body);
  const bootstrap = nodes.find((node) => node.tagName === "script");
  assert.ok(bootstrap);
  assert.ok(!bootstrap.attributes.some(({ name, value }) => name === "type" && value === "module"), "入口模块应由首绘后的经典脚本启动");
  const frames = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  const inserted: Element[] = [];
  const events: string[] = [];
  let replacement: Element | null = null;
  let nextFrame = 0;
  let onPaint: ((list: { getEntries: () => { name: string }[] }) => void) | undefined;
  let observing: { type: string; buffered: boolean } | null = null;
  let disconnected = false;
  class PerformanceObserver {
    static supportedEntryTypes = paintSupport === true ? ["paint"] : [];
    constructor(callback: NonNullable<typeof onPaint>) { onPaint = callback; }
    observe(options: NonNullable<typeof observing>) { observing = options; }
    disconnect() { disconnected = true; observing = null; }
  }
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
    performance: { getEntriesByName: () => existingPaint ? [{ name: "first-contentful-paint" }] : [] },
    ...(paintSupport === "absent" ? {} : { PerformanceObserver }),
    requestAnimationFrame(callback: () => void) {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number) { frames.delete(id); },
  });
  return {
    html, bootstrap, frames, listeners, inserted, events,
    observing() { return observing; },
    disconnected() { return disconnected; },
    paint(name: string) { onPaint?.({ getEntries: () => [{ name }] }); },
    replacement() { return replacement; },
    frame() {
      const [id, callback] = frames.entries().next().value ?? [];
      assert.ok(id);
      assert.ok(callback);
      frames.delete(id);
      callback();
    },
    hide() {
      document.visibilityState = "hidden";
      listeners.get("visibilitychange")?.();
    },
  };
}

test("首帧后成批激活预加载，再原位启动模块，启动前没有有效 modulepreload 或 module", () => {
  const run = startup();
  assert.equal(run.html.match(/<link/g), null);
  assert.ok(!run.bootstrap.attributes.some(({ name }) => name === "type"));
  assert.equal(run.replacement(), null);
  assert.deepEqual(run.inserted, []);
  run.frame();
  assert.equal(run.replacement(), null);
  run.frame();
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.deepEqual(markup(run.inserted), markup(parsedElements(lowA + lowB)));
  assert.equal(run.replacement()?.textContent, 'import "/assets/entry.client-A.js";');
  assert.equal(run.listeners.size, 0);
  assert.equal(run.frames.size, 0);
  run.hide();
  assert.deepEqual(run.events, ["preloads", "module"]);
});

test("初始后台无需等动画帧，预加载和模块只启动一次", () => {
  const run = startup({ hidden: true });
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.equal(run.frames.size, 0);
  assert.equal(run.listeners.size, 0);
  run.hide();
  assert.deepEqual(run.events, ["preloads", "module"]);
});

test("在任意一帧前转入后台会立即启动并清理排队的帧", () => {
  for (const beforeSecondFrame of [false, true]) {
    const run = startup();
    if (beforeSecondFrame) run.frame();
    const queued = [...run.frames.values()];
    run.hide();
    assert.deepEqual(run.events, ["preloads", "module"]);
    assert.equal(run.frames.size, 0);
    assert.equal(run.listeners.size, 0);
    for (const callback of queued) callback();
    assert.equal(run.frames.size, 0);
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
  assert.deepEqual(run.replacement()?.attributes, parsedElements(module)[0].attributes);
  assert.equal(run.replacement()?.textContent, parsedElements(module)[0].textContent);
  assert.deepEqual(markup(run.inserted), markup(parsedElements(preloads)));
});

test("没有 head 预加载时入口仍等首帧，普通脚本和外部模块脚本保持原样", () => {
  const run = startup({ preloads: "" });
  assert.equal(run.replacement(), null);
  run.frame();
  run.frame();
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

test("支持 Paint Timing 时只在 FCP 后启动，first-paint 不提前解锁模块", () => {
  const run = startup({ paintSupport: true });
  assert.equal(run.frames.size, 0);
  assert.equal(run.observing()?.type, "paint");
  assert.equal(run.observing()?.buffered, true);
  assert.equal(run.replacement(), null);
  run.paint("first-paint");
  assert.equal(run.replacement(), null);
  run.paint("first-contentful-paint");
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.equal(run.observing(), null);
  assert.equal(run.disconnected(), true);
  assert.equal(run.listeners.size, 0);
  run.paint("first-contentful-paint");
  assert.deepEqual(run.events, ["preloads", "module"]);
});

test("已有 FCP 时立即启动，不建立 observer 或动画帧", () => {
  const run = startup({ paintSupport: true, existingPaint: true });
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.equal(run.observing(), null);
  assert.equal(run.frames.size, 0);
  assert.equal(run.listeners.size, 0);
});

test("等待 FCP 时转入后台立即启动并断开 observer，后续通知不重复启动", () => {
  const run = startup({ paintSupport: true });
  run.hide();
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.equal(run.disconnected(), true);
  assert.equal(run.observing(), null);
  assert.equal(run.listeners.size, 0);
  run.paint("first-contentful-paint");
  assert.deepEqual(run.events, ["preloads", "module"]);
});

test("支持 Paint Timing 的初始后台标签不等待 observer", () => {
  const run = startup({ paintSupport: true, hidden: true });
  assert.deepEqual(run.events, ["preloads", "module"]);
  assert.equal(run.observing(), null);
  assert.equal(run.frames.size, 0);
});

test("缺少 PerformanceObserver 或不支持 paint 时才退回双动画帧", () => {
  for (const paintSupport of [false, "absent"] as const) {
    const run = startup({ paintSupport });
    assert.equal(run.observing(), null);
    run.frame();
    assert.equal(run.replacement(), null);
    run.frame();
    assert.deepEqual(run.events, ["preloads", "module"]);
  }
});
