import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  getLocalCharging,
  getLocalChargingServerSnapshot,
  subscribeLocalCharging,
} from "@/lib/local-charging";

const STALE_MS = 15_000;
const HISTORY_LIMIT = 120;
const ORIGIN = "http://127.0.0.1:8787";

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  send(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }

  sendRaw(data: string) {
    this.onmessage?.({ data });
  }
}

function installEnv(t: TestContext, { armed = true }: { armed?: boolean } = {}) {
  let now = 1_760_000_000_000;
  const store = new Map<string, string>();
  const timers: { dueAt: number; delay: number; fn: () => void; settled: boolean }[] = [];
  const windowListeners = new Map<string, Set<(event?: unknown) => void>>();
  const documentListeners = new Map<string, Set<(event?: unknown) => void>>();
  const cleanups: (() => void)[] = [];
  let windowAdds = 0;

  const listen = (map: Map<string, Set<(event?: unknown) => void>>) => ({
    add: (type: string, fn: (event?: unknown) => void) => {
      let set = map.get(type);
      if (!set) map.set(type, (set = new Set()));
      set.add(fn);
    },
    remove: (type: string, fn: (event?: unknown) => void) => {
      map.get(type)?.delete(fn);
    },
  });
  const win = listen(windowListeners);
  const doc = listen(documentListeners);
  const addWindow = (type: string, fn: (event?: unknown) => void) => {
    windowAdds += 1;
    win.add(type, fn);
  };

  if (armed) store.set("local-charging", "1");

  const fakeWindow = {
    setTimeout(fn: () => void, delay: number) {
      timers.push({ dueAt: now + delay, delay, fn, settled: false });
      return timers.length;
    },
    clearTimeout(id: number) {
      const timer = timers[id - 1];
      if (timer) timer.settled = true;
    },
    addEventListener: addWindow,
    removeEventListener: win.remove,
  };
  const fakeDocument = { addEventListener: doc.add, removeEventListener: doc.remove };
  const fakeStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  };
  FakeEventSource.instances = [];
  Object.assign(globalThis, {
    window: fakeWindow,
    document: fakeDocument,
    localStorage: fakeStorage,
    EventSource: FakeEventSource,
  });
  const realNow = Date.now;
  Date.now = () => now;

  t.after(() => {
    for (const fn of cleanups.splice(0).reverse()) fn();
    // @ts-expect-error 清理模拟全局
    delete globalThis.window;
    // @ts-expect-error 清理模拟全局
    delete globalThis.document;
    // @ts-expect-error 清理模拟全局
    delete globalThis.localStorage;
    // @ts-expect-error 清理模拟全局
    delete globalThis.EventSource;
    Date.now = realNow;
  });

  return {
    sources: FakeEventSource.instances,
    get now() {
      return now;
    },
    advance(ms: number) {
      now += ms;
    },
    setArmed() {
      store.set("local-charging", "1");
    },
    fireTimers() {
      for (const timer of [...timers]) {
        if (timer.settled || timer.dueAt > now) continue;
        timer.settled = true;
        timer.fn();
      }
    },
    pendingDelays: () => timers.filter((timer) => !timer.settled).map((timer) => timer.delay),
    dispatchWindow(type: string, event?: unknown) {
      for (const fn of windowListeners.get(type) ?? []) fn(event);
    },
    dispatchDocument(type: string) {
      for (const fn of documentListeners.get(type) ?? []) fn();
    },
    windowAdds: () => windowAdds,
    subscribe(onChange: () => void = () => {}) {
      const unsubscribe = subscribeLocalCharging(onChange);
      cleanups.push(unsubscribe);
      return unsubscribe;
    },
  };
}

function chargerFrame(totalOutputW = 60) {
  return { connected: true, device: { connected: true, totalOutputW } };
}

test("服务端快照是固定的空载荷", () => {
  assert.deepEqual(getLocalChargingServerSnapshot(), { charger: null, powerBank: null });
  assert.equal(getLocalChargingServerSnapshot(), getLocalChargingServerSnapshot());
  assert.equal(getLocalCharging(), getLocalChargingServerSnapshot());
});

test("没插旗的访客不连本机", (t) => {
  const env = installEnv(t, { armed: false });
  let calls = 0;
  env.subscribe(() => {
    calls += 1;
  });
  assert.equal(env.sources.length, 0);
  assert.deepEqual(getLocalCharging(), { charger: null, powerBank: null });
  env.dispatchWindow("focus");
  assert.equal(env.sources.length, 0);
  assert.equal(calls, 0);
});

test("插旗后连本机两条流，帧落成带在场信息的快照", (t) => {
  const env = installEnv(t);
  let calls = 0;
  env.subscribe(() => {
    calls += 1;
  });
  assert.deepEqual(env.sources.map((source) => source.url), [
    `${ORIGIN}/sse/charger`,
    `${ORIGIN}/sse/powerbank`,
  ]);
  const [charger, powerBank] = env.sources as [FakeEventSource, FakeEventSource];
  charger.onopen?.();
  powerBank.onopen?.();

  charger.send({
    connected: true,
    device: {
      id: "serial-charger",
      kind: "charger",
      model: "A2687",
      firmware: "1.2.3",
      connected: true,
      totalOutputW: 65.5,
      updatedAt: 1_760_000_000,
      ports: [
        { name: "c1", active: true, voltageV: 20, currentA: 3.2, powerW: 64, attachedDevice: { model: "MacBook Pro" }, chargingInfo: "PD3.1", cable: "240W" },
      ],
      cover: { name: "桌面手办", iconHash: "a".repeat(64), iconObjectKey: `${"b".repeat(64)}.png` },
    },
  });

  const payload = getLocalCharging().charger;
  assert.equal(payload?.connected, true);
  assert.equal(payload?.totalPower, 65.5);
  assert.equal(payload?.pushedAt, env.now);
  assert.equal(payload?.lastSeenAt, env.now);
  assert.equal(payload?.staleAfterMs, STALE_MS);
  assert.equal(payload?.heartbeatWindowMs, STALE_MS);
  assert.equal(payload?.declaredOffline, false);
  assert.equal(payload?.historyPartial, false);
  assert.deepEqual(payload?.history, [{ t: env.now, w: 65.5 }]);
  assert.equal(payload?.updatedAt, 1_760_000_000 * 1000);
  assert.equal(payload?.ports[0]?.id, "C1");
  assert.equal(payload?.ports[0]?.power, 64);
  assert.equal(payload?.cover?.iconUrl, `/img/${"b".repeat(64)}.png`);
  assert.equal("serialNumber" in (payload?.device ?? {}), false);

  powerBank.send({
    connected: true,
    device: {
      id: "serial-bank",
      connected: true,
      battery: { percent: 82, charging: true, timeToFullMinutes: 40, healthPercent: 95 },
      totalOutputW: 22,
      temperaturesC: [34.5],
      ports: [{ name: "C1", active: true, direction: "out", powerW: 22 }],
    },
  });
  const bank = getLocalCharging().powerBank;
  assert.equal(bank?.connected, true);
  assert.equal(bank?.battery, 82);
  assert.equal(bank?.outputPower, 22);
  assert.equal(bank?.ports[0]?.direction, "out");
  assert.equal(bank?.staleAfterMs, STALE_MS);
  assert.equal(bank?.heartbeatWindowMs, STALE_MS);
  assert.equal("serialNumber" in (bank?.device ?? {}), false);
  assert.equal(calls, 2);
});

test("connected 要 BLE 与设备两侧都为真，缺设备帧只看 BLE 侧", (t) => {
  const env = installEnv(t);
  env.subscribe();
  const charger = env.sources[0]!;
  charger.onopen?.();
  const send = (event: Record<string, unknown>) => {
    charger.send(event);
    return getLocalCharging().charger;
  };

  assert.equal(send(chargerFrame(60))?.connected, true);
  assert.equal(send({ connected: true, device: { connected: false, totalOutputW: 60 } })?.connected, false);
  assert.equal(send({ connected: false, device: { connected: true, totalOutputW: 60 } })?.connected, false);
  assert.equal(send({ connected: "true", device: { connected: true, totalOutputW: 60 } })?.connected, false);
  assert.equal(send({ connected: true })?.connected, true);

  const last = getLocalCharging().charger;
  assert.equal(last?.totalPower, 0);
  assert.deepEqual(last?.history.map((sample) => sample.w), [60, 0, 0, 0, 0]);
});

test("功率历史按帧追加，封顶后滚动丢弃最旧样本", (t) => {
  const env = installEnv(t);
  env.subscribe();
  const charger = env.sources[0]!;
  charger.onopen?.();

  const first = getLocalCharging().charger;
  charger.send(chargerFrame(1));
  const second = getLocalCharging().charger;
  assert.notEqual(second?.history, first?.history ?? null);

  env.advance(1_000);
  for (let i = 2; i <= HISTORY_LIMIT + 5; i += 1) {
    charger.send(chargerFrame(i));
    env.advance(1_000);
  }
  const history = getLocalCharging().charger?.history ?? [];
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0]?.w, 6);
  assert.equal(history.at(-1)?.w, HISTORY_LIMIT + 5);
  for (let i = 1; i < history.length; i += 1) {
    assert.equal(history[i]!.t - history[i - 1]!.t, 1_000);
  }
});

test("封面 iconUrl 由 objectKey 拼出，缺 objectKey 时为 null", (t) => {
  const env = installEnv(t);
  env.subscribe();
  const charger = env.sources[0]!;
  const key = `${"b".repeat(64)}.png`;

  charger.send({ connected: true, device: { connected: true, cover: { name: "手办", iconHash: "a".repeat(64), iconObjectKey: key } } });
  assert.equal(getLocalCharging().charger?.cover?.iconUrl, `/img/${key}`);

  charger.send({ connected: true, device: { connected: true, cover: { name: "手办" } } });
  assert.deepEqual(getLocalCharging().charger?.cover, { name: "手办", iconHash: null, iconObjectKey: null, iconUrl: null });

  charger.send({ connected: true, device: { connected: true } });
  assert.equal(getLocalCharging().charger?.cover, null);
});

test("不合契约的字段让整帧作废，不派发半截状态", (t) => {
  const env = installEnv(t);
  let calls = 0;
  env.subscribe(() => {
    calls += 1;
  });
  const charger = env.sources[0]!;

  charger.send(chargerFrame(30));
  const before = getLocalCharging().charger;
  charger.send({ connected: true, device: { connected: true, cover: { iconHash: "a".repeat(64) } } });
  assert.equal(getLocalCharging().charger, before);
  assert.equal(calls, 1);
});

test("坏帧静默丢弃：非法 JSON、非对象 JSON、device 非对象", (t) => {
  const env = installEnv(t);
  let calls = 0;
  env.subscribe(() => {
    calls += 1;
  });
  const charger = env.sources[0]!;

  charger.sendRaw("not json{");
  charger.sendRaw("[1,2,3]");
  charger.sendRaw("42");
  assert.equal(getLocalCharging().charger, null);
  assert.equal(calls, 0);

  charger.send({ connected: true, device: "not-an-object" });
  assert.equal(getLocalCharging().charger?.connected, true);
  charger.send({ connected: true, device: [1, 2] });
  assert.equal(getLocalCharging().charger?.connected, true);
  assert.equal(getLocalCharging().charger?.device?.model, null);
  assert.equal(calls, 2);
});

test("没开过的流出错立即关闭；来过帧的流出错留给 EventSource 自重连", (t) => {
  const env = installEnv(t);
  env.subscribe();
  const [charger, powerBank] = env.sources as [FakeEventSource, FakeEventSource];

  powerBank.send({ connected: true, device: { connected: true, battery: { percent: 50 } } });
  powerBank.onerror?.();
  assert.equal(powerBank.closed, false);
  assert.equal(getLocalCharging().powerBank?.battery, 50);

  charger.onerror?.();
  assert.equal(charger.closed, true);
  assert.equal(getLocalCharging().charger, null);
});

test("连上却不出首帧也会被看门狗收掉", (t) => {
  const env = installEnv(t);
  env.subscribe();
  const charger = env.sources[0]!;

  charger.onopen?.();
  env.advance(STALE_MS);
  env.fireTimers();
  assert.equal(charger.closed, true);
  assert.equal(getLocalCharging().charger, null);
});

test("看门狗按真实空闲重排，不误杀刚来过帧的流", (t) => {
  const env = installEnv(t);
  env.subscribe();
  const charger = env.sources[0]!;

  charger.onopen?.();
  assert.deepEqual(env.pendingDelays(), [STALE_MS]);
  env.advance(10_000);
  charger.send(chargerFrame(30));
  env.advance(5_000);
  env.fireTimers();
  assert.equal(charger.closed, false);
  assert.deepEqual(env.pendingDelays(), [STALE_MS - 5_000]);

  env.advance(10_000);
  env.fireTimers();
  assert.equal(charger.closed, true);
  assert.equal(getLocalCharging().charger, null);
});

test("看门狗收掉充电流只清充电卡，充电宝流照常更新", (t) => {
  const env = installEnv(t);
  env.subscribe();
  const [charger, powerBank] = env.sources as [FakeEventSource, FakeEventSource];

  charger.onopen?.();
  charger.send(chargerFrame(40));
  env.advance(5_000);
  powerBank.onopen?.();
  powerBank.send({ connected: true, device: { connected: true, battery: { percent: 50 } } });
  env.advance(STALE_MS - 5_000);
  env.fireTimers();

  assert.equal(charger.closed, true);
  assert.equal(powerBank.closed, false);
  assert.equal(getLocalCharging().charger, null);
  assert.equal(getLocalCharging().powerBank?.battery, 50);

  powerBank.send({ connected: true, device: { connected: true, battery: { percent: 51 } } });
  assert.equal(getLocalCharging().powerBank?.battery, 51);
});

test("最后一个订阅者退订：断流、清空快照与历史，重订从零开始", (t) => {
  const env = installEnv(t);
  const unsubscribe = env.subscribe();
  const charger = env.sources[0]!;
  charger.onopen?.();
  charger.send(chargerFrame(50));
  charger.send(chargerFrame(60));

  unsubscribe();
  assert.equal(charger.closed, true);
  assert.equal(env.sources[1]!.closed, true);
  assert.deepEqual(getLocalCharging(), { charger: null, powerBank: null });

  env.subscribe();
  assert.equal(env.sources.length, 4);
  const fresh = env.sources[2]!;
  fresh.send(chargerFrame(7));
  assert.deepEqual(getLocalCharging().charger?.history.map((sample) => sample.w), [7]);
});

test("多订阅者共享一条连接与一份全局监听", (t) => {
  const env = installEnv(t);
  const unsubA = env.subscribe();
  let bCalls = 0;
  env.subscribe(() => {
    bCalls += 1;
  });
  assert.equal(env.sources.length, 2);
  assert.equal(env.windowAdds(), 2);

  unsubA();
  const charger = env.sources[0]!;
  assert.equal(charger.closed, false);
  charger.send(chargerFrame(9));
  assert.equal(bCalls, 1);
});

test("storage 事件只在旗子真置 1 时拉起连接", (t) => {
  const env = installEnv(t, { armed: false });
  env.subscribe();

  env.dispatchWindow("storage", { key: "local-charging", newValue: "1" });
  assert.equal(env.sources.length, 0);

  env.setArmed();
  env.dispatchWindow("storage", { key: "other", newValue: "1" });
  env.dispatchWindow("storage", { key: "local-charging", newValue: "0" });
  assert.equal(env.sources.length, 0);

  env.dispatchWindow("storage", { key: "local-charging", newValue: "1" });
  assert.equal(env.sources.length, 2);
});

test("一侧更新不动另一侧的快照引用", (t) => {
  const env = installEnv(t);
  env.subscribe();
  const [charger, powerBank] = env.sources as [FakeEventSource, FakeEventSource];

  charger.send(chargerFrame(10));
  const before = getLocalCharging();
  powerBank.send({ connected: true, device: { connected: true, battery: { percent: 88 } } });
  const after = getLocalCharging();
  assert.notEqual(after, before);
  assert.equal(after.charger, before.charger);
});

test(
  "源被看门狗或失败关掉后，回到前台应能重连",
  { todo: "start() 被 started 短路挡住：onClosed 不复位 started，focus/visibilitychange/storage 的重连路径全是死代码，卡片停在空态直到重新挂载；修实现后启用" },
  (t) => {
    const env = installEnv(t);
    env.subscribe();
    const charger = env.sources[0]!;
    charger.onopen?.();
    charger.send(chargerFrame(40));
    env.advance(STALE_MS);
    env.fireTimers();
    assert.equal(getLocalCharging().charger, null);
    env.dispatchWindow("focus");
    assert.ok(env.sources.length > 2, "回到前台应重新建立本机流");
  },
);
