import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ReadModelPublisher, type PublicationSql } from "./read-model-publisher.ts";
import { serveReadModel, type ReadModelReader } from "./read-model-edge.ts";
import { READ_MODEL_PATHS, readModelKey, readModelPathsForSource, readModelPolicy, usableReadModel, type ReadModelKv } from "./read-model.ts";

const path = "/api/status/github-repo";
const body = JSON.stringify({ ok: true, data: { title: "example" } });
function view(at: number, revision = 1) { return { schema: 1, path, revision, generatedAt: at, body }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const db = new DatabaseSync(":memory:");
  let now = 1_000_000;
  let renders = 0;
  const written: { key: string; value: string; at: number; ttl: number }[] = [];
  const values = new Map<string, unknown>();
  const sql: PublicationSql = {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      if (/^\s*SELECT\b/i.test(query)) return { toArray: () => statement.all(...bindings) };
      statement.run(...bindings);
      return { toArray: () => [] };
    },
  };
  const kv: ReadModelKv = {
    async get(key) { return values.get(key) ?? null; },
    async put(key, value, options) {
      written.push({ key, value, at: now, ttl: options.expirationTtl });
      values.set(key, JSON.parse(value));
    },
  };
  const options = {
    sql, kv, prefix: "test", now: () => now,
    render: async () => { renders++; return new Response(body, { headers: { "Content-Type": "application/json" } }); },
    log: () => {},
  };
  return { db, sql, kv, values, written, options,
    advance(ms: number) { now += ms; }, now: () => now, renders: () => renders };
}

function reader(options: Partial<ReadModelReader> = {}) {
  const calls = { origin: 0, refresh: [] as string[], get: 0, put: 0 };
  const deps: ReadModelReader = {
    prefix: "test", enabled: true, allowedOrigin: true,
    now: () => 1_000_000, cors: new Headers({ "Access-Control-Allow-Origin": "https://current.example", Vary: "Origin" }),
    kv: { async get() { calls.get++; return view(999_000); }, async put() { calls.put++; } },
    origin: async () => { calls.origin++; return Response.json({ ok: true, data: "origin" }); },
    refresh: (target) => { calls.refresh.push(target); }, ...options,
  };
  return { calls, deps };
}

test("read model: allowlist excludes live, liveness, credentials, coordination and mutable query variants", async () => {
  for (const target of ["/ws", "/count", "/api/home", "/api/musickit/token", "/api/ingest/mac", "/api/internal/storage/import", "/api/status/server", "/api/status/activity", "/api/status/desktop", "/api/status/charger", "/api/status/powerbank", "/api/status/vibecoding", "/api/status/listening", "/api/status/listening/now", "/api/status/watching", "/api/status/watching/now", "/api/status/playing", "/api/status/playing/now", "/api/status/trophies", "/api/lyrics", "/api/motion-artwork", "constructor", "__proto__"]) {
    assert.equal(readModelPolicy(target), undefined, target);
    const { calls, deps } = reader();
    await serveReadModel(new Request(`https://api.example${target.startsWith("/") ? target : `/${target}`}`), deps);
    assert.equal(calls.get, 0, target);
    assert.equal(calls.origin, 1);
  }
  for (const suffix of ["?q=1", "?since=2026-09-01", "?other=1"]) {
    const { calls, deps } = reader();
    await serveReadModel(new Request(`https://api.example${path}${suffix}`), deps);
    assert.equal(calls.get, 0);
    assert.equal(calls.origin, 1);
  }
  assert.ok(READ_MODEL_PATHS.every(target => readModelPolicy(target)));
  assert.deepEqual([...READ_MODEL_PATHS].sort(), [
    "/api/status/github-chart",
    "/api/status/github-repo",
    "/api/status/reporters",
    "/api/status/sentry",
    "/api/status/vercel-deployments",
    "/api/status/vibecoding/year",
  ]);
  assert.deepEqual(readModelPathsForSource("mac"), ["/api/status/vibecoding/year"]);
  assert.deepEqual(readModelPathsForSource("emby"), []);
  assert.deepEqual(readModelPathsForSource("playstation"), []);
  assert.deepEqual(readModelPathsForSource("constructor"), []);
});

test("read model: a hit avoids origin and reconstructs CORS for this request", async () => {
  const { calls, deps } = reader();
  const response = await serveReadModel(new Request(`https://api.example${path}`), deps);
  assert.equal(await response.text(), body);
  assert.equal(calls.origin, 0);
  assert.equal(calls.put, 0);
  assert.deepEqual(calls.refresh, []);
  assert.equal(response.headers.get("x-read-model"), "kv");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), "https://current.example");
  assert.equal(response.headers.get("vary"), "Origin");
  assert.equal(response.headers.get("x-fetched-at"), new Date(999_000).toISOString());
});

test("read model: disabled binding, local bypass, rejected origin, POST and OPTIONS cannot read a cached success", async () => {
  for (const changes of [{ enabled: false }, { kv: undefined }, { allowedOrigin: false }]) {
    const { calls, deps } = reader(changes);
    await serveReadModel(new Request(`https://api.example${path}`), deps);
    assert.equal(calls.get, 0);
    assert.equal(calls.origin, 1);
  }
  for (const method of ["POST", "OPTIONS", "DELETE", "HEAD"]) {
    const { calls, deps } = reader();
    await serveReadModel(new Request(`https://api.example${path}`, { method }), deps);
    assert.equal(calls.get, 0);
    assert.equal(calls.origin, 1);
  }
});

test("read model: negative lookup, invalid schema, stale/future data and KV errors fall back without edge puts", async () => {
  const variants = [null, {}, { ...view(999_000), schema: 2 }, view(1_001_000), view(1_000_000 - 600_000), { ...view(999_000), body: "not json" }, { ...view(999_000), body: '{"ok":false}' }, { ...view(999_000), path: "/private" }];
  for (const value of variants) {
    const { calls, deps } = reader({ kv: { async get() { return value; }, async put() { assert.fail("edge must not write"); } } });
    const response = await serveReadModel(new Request(`https://api.example${path}`), deps);
    assert.equal(response.headers.get("x-read-model"), "origin");
    assert.equal(calls.origin, 1);
    assert.deepEqual(calls.refresh, [path]);
  }
  const { calls, deps } = reader({ kv: { async get() { throw new Error("KV unavailable"); }, async put() {} } });
  await serveReadModel(new Request(`https://api.example${path}`), deps);
  assert.equal(calls.origin, 1);
});

test("read model: hanging KV is bounded and failed authority is not replaced by stale cached success", async () => {
  const { calls, deps } = reader({ timeoutMs: 5, kv: { get: () => new Promise(() => {}), async put() {} } });
  await serveReadModel(new Request(`https://api.example${path}`), deps);
  assert.equal(calls.origin, 1);
  const failure = reader({ kv: { async get() { return view(0); }, async put() {} }, origin: async () => new Response("unavailable", { status: 503 }) });
  const response = await serveReadModel(new Request(`https://api.example${path}`), failure.deps);
  assert.equal(response.status, 503);
  assert.deepEqual(failure.calls.refresh, []);
});

test("publisher: enqueue does no network, coalesces bursts, and stores only allowlisted public response bodies", async () => {
  const f = setup();
  try {
    const p = new ReadModelPublisher(f.options);
    p.enqueue([path, path, "/api/internal/storage/import"]);
    p.enqueue([path]);
    assert.equal(f.written.length, 0);
    assert.equal(f.renders(), 0);
    const deadline = p.nextAlarm();
    f.advance(500); p.enqueue([path]);
    assert.equal(p.nextAlarm(), deadline, "later marks must not postpone publication");
    await p.flush();
    assert.equal(f.written.length, 0);
    f.advance(1_500); await p.flush();
    assert.equal(f.written.length, 1);
    assert.equal(f.written[0].key, readModelKey("test", path));
    const value = JSON.parse(f.written[0].value);
    assert.equal(value.revision, 3);
    assert.equal(value.body, body);
    assert.equal(f.written[0].ttl, 660);
    assert.equal(p.nextAlarm(), null);
    assert.equal(usableReadModel(value, path, f.now()), true);
  } finally { f.db.close(); }
});

test("publisher: a newer report during render stays dirty and is eventually published", async () => {
  const f = setup();
  const gate = deferred<Response>();
  let first = true;
  try {
    const p = new ReadModelPublisher({ ...f.options, render: () => first ? (first = false, gate.promise) : f.options.render() });
    p.enqueue([path]); f.advance(2_000);
    const flush = p.flush();
    p.enqueue([path]);
    gate.resolve(Response.json({ ok: true, data: "earlier" }));
    await flush;
    assert.equal(JSON.parse(f.written[0].value).revision, 1);
    assert.notEqual(p.nextAlarm(), null);
    f.advance(300_000); await p.flush();
    assert.equal(JSON.parse(f.written[1].value).revision, 2);
    assert.equal(p.nextAlarm(), null);
  } finally { f.db.close(); }
});

test("publisher: dirty generation arriving during KV put is not acknowledged as published", async () => {
  const f = setup();
  const gate = deferred<void>();
  let first = true;
  try {
    const p = new ReadModelPublisher({ ...f.options, kv: { ...f.kv, async put(key, value, options) {
      if (first) { first = false; await gate.promise; }
      await f.kv.put(key, value, options);
    } } });
    p.enqueue([path]); f.advance(2_000);
    const flush = p.flush();
    // Allow render/text to reach put, then accept another state change.
    await new Promise(resolve => setTimeout(resolve, 0));
    p.enqueue([path]); gate.resolve(); await flush;
    assert.notEqual(p.nextAlarm(), null);
    f.advance(300_000); await p.flush();
    assert.equal(f.written.length, 2);
    assert.equal(p.nextAlarm(), null);
  } finally { f.db.close(); }
});

test("publisher: KV failure persists retry; restart and cron do not lose it or bypass cooldown", async () => {
  const f = setup();
  try {
    const broken = new ReadModelPublisher({ ...f.options, kv: { ...f.kv, async put() { throw new Error("429"); } } });
    broken.enqueue([path]); f.advance(2_000); await broken.flush();
    const deadline = broken.nextAlarm();
    assert.equal(deadline, f.now() + 60_000);
    const restarted = new ReadModelPublisher(f.options);
    restarted.enqueue([path]);
    assert.equal(restarted.nextAlarm(), deadline);
    await restarted.flush(); assert.equal(f.written.length, 0);
    f.advance(60_000); await restarted.flush();
    assert.equal(f.written.length, 1);
    assert.equal(restarted.nextAlarm(), null);
  } finally { f.db.close(); }
});

test("publisher: slow renders cannot cause successive puts less than the publication interval apart", async () => {
  const f = setup();
  try {
    const p = new ReadModelPublisher({ ...f.options, render: async () => { f.advance(90_000); return f.options.render(); } });
    p.enqueue([path]); f.advance(2_000); await p.flush();
    p.enqueue([path]); await p.flush();
    assert.equal(f.written.length, 1);
    const restarted = new ReadModelPublisher(f.options);
    await restarted.flush(); assert.equal(f.written.length, 1);
    f.advance(300_000); await restarted.flush();
    assert.ok(f.written[1].at - f.written[0].at >= 300_000);
  } finally { f.db.close(); }
});

test("publisher: HTTP/logical errors and over-age renders may not be published", async () => {
  const f = setup();
  try {
    const p = new ReadModelPublisher(f.options);
    p.enqueue([path]); f.advance(2_000); await p.flush();
    assert.equal(f.written.length, 1);
    for (const render of [
      async () => new Response("redirect", { status: 302 }),
      async () => Response.json({ ok: false, error: "upstream" }),
      async () => new Response("<html>wrong</html>"),
      async () => { f.advance(600_000); return Response.json({ ok: true, data: 1 }); },
    ]) {
      const rejected = new ReadModelPublisher({ ...f.options, render });
      rejected.enqueue([path]); f.advance(300_000); await rejected.flush();
      assert.equal(f.written.length, 1);
      assert.notEqual(rejected.nextAlarm(), null);
    }
  } finally { f.db.close(); }
});

test("publisher: empty flush is idle, bounded batch drains, and duplicate flush does not overlap puts", async () => {
  const f = setup();
  const gate = deferred<Response>();
  try {
    const p = new ReadModelPublisher({ ...f.options, render: () => gate.promise });
    assert.equal(p.nextAlarm(), null); await p.flush();
    p.enqueue([path]); f.advance(2_000);
    const first = p.flush(); await p.flush();
    gate.resolve(Response.json({ ok: true, data: 1 })); await first;
    assert.equal(f.written.length, 1);
    const batch = new ReadModelPublisher(f.options);
    batch.enqueue(["/api/status/github-chart", "/api/status/vercel-deployments", "/api/status/vibecoding/year"]); f.advance(2_000);
    await batch.flush(2); assert.notEqual(batch.nextAlarm(), null);
    await batch.flush(2); assert.equal(batch.nextAlarm(), null);
  } finally { f.db.close(); }
});

test("publisher: a hung render is bounded, keeps the job dirty with a retry cooldown, and later succeeds", async () => {
  const f = setup();
  const errors: unknown[] = [];
  try {
    const hung = new ReadModelPublisher({ ...f.options, renderTimeoutMs: 20, log: (_, error) => { errors.push(error); },
      render: () => new Promise<Response>(() => {}) });
    hung.enqueue([path]); f.advance(2_000);
    await hung.flush();
    assert.equal(f.written.length, 0);
    assert.equal(errors.length, 1);
    assert.match(String((errors[0] as Error).message), /timeout/);
    assert.equal(hung.nextAlarm(), f.now() + 60_000);
    const healthy = new ReadModelPublisher(f.options);
    f.advance(60_000); await healthy.flush();
    assert.equal(f.written.length, 1);
    assert.equal(healthy.nextAlarm(), null);
  } finally { f.db.close(); }
});

test("publisher: a stale row for a path no longer in the policy table is dropped instead of spinning the alarm", async () => {
  const f = setup();
  try {
    const p = new ReadModelPublisher(f.options);
    f.sql.exec("INSERT INTO public_read_model_jobs(path, revision, next_at) VALUES (?, 1, ?)", "/api/status/retired", f.now());
    assert.equal(p.nextAlarm(), f.now());
    await p.flush();
    assert.equal(p.nextAlarm(), null);
    assert.equal(f.renders(), 0);
    assert.equal(f.sql.exec("SELECT path FROM public_read_model_jobs").toArray().length, 0);
  } finally { f.db.close(); }
});
