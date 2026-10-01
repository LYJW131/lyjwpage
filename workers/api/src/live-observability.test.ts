import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { CloudflareOptions } from "@sentry/cloudflare";

import type { Env } from "./runtime";

const workerRuntime = `export class DurableObject {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
}`;
const runtimeHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: `data:text/javascript,${encodeURIComponent(workerRuntime)}`, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL?.includes("/node_modules/")) {
      const absolute = fileURLToPath(new URL(specifier, context.parentURL).href);
      if (existsSync(`${absolute}.js`)) return nextResolve(`${absolute}.js`, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("file:") && url.endsWith(".ts") && !url.includes("/node_modules/")) {
      return {
        format: "module", shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceUrl: url }),
      };
    }
    return nextLoad(url, context);
  },
});
const Sentry = await import("@sentry/cloudflare");
const { sentryOptions } = await import("./sentry");
const { default: originWorker, LivePushRoom } = await import("./origin-worker");
runtimeHook.deregister();

type ErrorEvent = Parameters<NonNullable<CloudflareOptions["beforeSend"]>>[0];
type StorageOperation = "getAlarm" | "setAlarm";

class LocalSocket {
  mark: unknown;
  messages: string[] = [];
  serializeAttachment(mark: unknown): void { this.mark = mark; }
  deserializeAttachment(): unknown { return this.mark; }
  send(message: string): void { this.messages.push(message); }
  close(): void {}
}

class LocalState {
  sockets: LocalSocket[] = [];
  pending: Promise<unknown>[] = [];
  calls: StorageOperation[] = [];
  storage: {
    getAlarm: () => Promise<number | null>;
    setAlarm: (at: number) => Promise<void>;
    kv: { get: () => undefined; put: () => void };
  };

  constructor(operation: StorageOperation, failure: Error) {
    this.storage = {
      getAlarm: async () => {
        this.calls.push("getAlarm");
        if (operation === "getAlarm") throw failure;
        return null;
      },
      setAlarm: async () => {
        this.calls.push("setAlarm");
        if (operation === "setAlarm") throw failure;
      },
      kv: { get: () => undefined, put: () => {} },
    };
  }

  waitUntil(promise: Promise<unknown>): void {
    this.pending.push(promise);
    void promise.catch(() => {});
  }
  acceptWebSocket(socket: LocalSocket): void { this.sockets.push(socket); }
  getWebSockets(): LocalSocket[] { return this.sockets; }
  getWebSocketAutoResponseTimestamp(): null { return null; }
  setWebSocketAutoResponse(): void {}

  async drain(): Promise<PromiseSettledResult<unknown>[]> {
    const results: PromiseSettledResult<unknown>[] = [];
    let index = 0;
    while (index < this.pending.length) {
      const batch = this.pending.slice(index);
      index = this.pending.length;
      results.push(...await Promise.allSettled(batch));
    }
    return results;
  }
}

function recordingOptions(env: Env, className?: "LivePushRoom") {
  const events: ErrorEvent[] = [];
  const originals: unknown[] = [];
  const clients = new Set<NonNullable<ReturnType<typeof Sentry.getClient>>>();
  const options = sentryOptions(env, className);
  const configured: CloudflareOptions = {
    ...options,
    dsn: "https://public@example.invalid/1",
    tracesSampleRate: 0,
    transport: () => ({
      send: async (envelope) => {
        for (const [header, payload] of envelope[1]) {
          if (header.type === "event") events.push(payload as ErrorEvent);
        }
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
    beforeSend: (event, hint) => {
      originals.push(hint.originalException);
      const client = Sentry.getClient();
      if (client) clients.add(client);
      return options.beforeSend!(event, hint);
    },
  };
  return {
    events, originals,
    optionsForEnv: (currentEnv: Env) => {
      assert.equal(currentEnv.CF_VERSION_METADATA?.id, env.CF_VERSION_METADATA?.id);
      return configured;
    },
    dispose: () => { for (const client of clients) client.dispose(); },
  };
}

function assertFailure(
  recording: ReturnType<typeof recordingOptions>,
  error: Error,
  method: "fetch" | "alarm" | "webSocketMessage" | "audience",
  operation?: StorageOperation,
): void {
  assert.equal(recording.originals.length, 1);
  assert.equal(recording.originals[0], error);
  assert.equal(recording.events.length, 1);
  const event = recording.events[0];
  assert.equal(event.tags?.["do.class"], "LivePushRoom");
  assert.equal(event.tags?.["do.method"], method);
  assert.equal(event.tags?.["do.storage_operation"], operation);
  assert.equal(event.tags?.["do.retryable"], "true");
  assert.equal(event.tags?.["do.overloaded"], "false");
  assert.equal(event.release, "test-worker-version");
  assert.equal(event.contexts?.deployment?.version_id, "test-worker-version");
}

test("LivePushRoom 真实 SDK 捕获链路保留异常、诊断字段和既有执行语义", async (t) => {
  const originalResponse = globalThis.Response;
  const originalFetch = globalThis.fetch;
  const previousUpstream = process.env.UPSTREAM_API_URL;
  const globalDescriptors = ["WebSocketPair", "WebSocketRequestResponsePair"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  delete process.env.UPSTREAM_API_URL;
  globalThis.fetch = async () => { throw new Error("Tests must not use the network"); };
  globalThis.Response = class extends originalResponse {
    private upgrade: boolean;
    webSocket: WebSocket | null;
    constructor(body?: BodyInit | null, init?: ResponseInit) {
      super(body, init?.status === 101 ? { ...init, status: 200 } : init);
      this.upgrade = init?.status === 101;
      this.webSocket = init?.webSocket ?? null;
    }
    override get status(): number { return this.upgrade ? 101 : super.status; }
  };
  Object.defineProperties(globalThis, {
    WebSocketPair: { configurable: true, value: class { 0 = new LocalSocket(); 1 = new LocalSocket(); } },
    WebSocketRequestResponsePair: { configurable: true, value: class {} },
  });
  t.after(() => {
    globalThis.Response = originalResponse;
    globalThis.fetch = originalFetch;
    if (previousUpstream === undefined) delete process.env.UPSTREAM_API_URL;
    else process.env.UPSTREAM_API_URL = previousUpstream;
    for (const [key, descriptor] of globalDescriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  const env = { CF_VERSION_METADATA: { id: "test-worker-version" } } as Env;
  for (const operation of ["getAlarm", "setAlarm"] as const) {
    await t.test(`fetch 升级成功，后台 ${operation} 失败仅捕获一次并保持拒绝`, async (t) => {
      const error = Object.assign(new Error(`background ${operation}`), { retryable: true, overloaded: false });
      const state = new LocalState(operation, error);
      const recording = recordingOptions(env, "LivePushRoom");
      t.after(recording.dispose);
      const InstrumentedRoom = Sentry.instrumentDurableObjectWithSentry(recording.optionsForEnv, LivePushRoom);
      const room = new InstrumentedRoom(state as unknown as DurableObjectState, env);
      const response = await room.fetch(new Request("https://worker.invalid/ws?visible=1", { headers: { Upgrade: "websocket" } }));
      assert.equal(response.status, 101);
      assert.equal(state.sockets.length, 1);
      const results = await state.drain();
      const rejected = results.filter((result) => result.status === "rejected");
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason, error);
      assert.deepEqual(state.calls, operation === "getAlarm" ? ["getAlarm"] : ["getAlarm", "setAlarm"]);
      assertFailure(recording, error, "fetch", operation);
      assert.equal(recording.events[0].exception?.values?.[0]?.mechanism?.type, "manual.live_push.announce");
    });
  }

  for (const method of ["alarm", "webSocketMessage"] as const) {
    await t.test(`${method} 失败由 SDK 自动捕获一次`, async (t) => {
      const operation = method === "alarm" ? "setAlarm" : "getAlarm";
      const error = Object.assign(new Error(`${method} ${operation}`), { retryable: true, overloaded: false });
      const state = new LocalState(operation, error);
      const socket = new LocalSocket();
      socket.serializeAttachment({ at: Date.now(), visible: true, seenAt: Date.now() });
      state.sockets.push(socket);
      const recording = recordingOptions(env, "LivePushRoom");
      t.after(recording.dispose);
      const InstrumentedRoom = Sentry.instrumentDurableObjectWithSentry(recording.optionsForEnv, LivePushRoom);
      const room = new InstrumentedRoom(state as unknown as DurableObjectState, env);
      await assert.rejects(method === "alarm" ? room.alarm() : room.webSocketMessage(socket as unknown as WebSocket, "visible"),
        (actual) => actual === error);
      await state.drain();
      assert.deepEqual(state.calls, [operation]);
      assertFailure(recording, error, method, operation);
      assert.equal(recording.events[0].exception?.values?.[0]?.mechanism?.type, "auto.faas.cloudflare.durable_object");
    });
  }

  await t.test("count 远端错误只有 audience 边界，不伪造存储操作", async (t) => {
    const error = Object.assign(new Error("remote audience"), { retryable: true, overloaded: false, remote: true });
    const state = new LocalState("getAlarm", error);
    let calls = 0;
    const remoteEnv = {
      ...env,
      LIVE_PUSH: { idFromName: () => "local-room", get: () => ({ audience: async () => { calls += 1; throw error; } }) },
    } as unknown as Env;
    const recording = recordingOptions(remoteEnv);
    t.after(recording.dispose);
    const worker = Sentry.withSentry(recording.optionsForEnv, {
      fetch: (request: Request, currentEnv: Env, ctx: ExecutionContext) => originWorker.fetch(request, currentEnv, ctx),
    });
    await assert.rejects(worker.fetch(new Request("https://worker.invalid/count"), remoteEnv, state as unknown as ExecutionContext),
      (actual) => actual === error);
    await state.drain();
    assert.equal(calls, 1);
    assert.deepEqual(state.calls, []);
    assertFailure(recording, error, "audience");
    assert.equal(recording.events[0].tags?.["do.remote"], "true");
    assert.equal(recording.events[0].contexts?.durable_object?.storage_operation, undefined);
  });
});
