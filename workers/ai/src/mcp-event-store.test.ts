import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { EventRpcError } from './mcp-event-errors.ts';
import { MCP_EVENT_LIMITS, McpEventStore, type EventIo, type EventStorage, type EventSubscription, type PendingEvent } from './mcp-event-store.ts';
import type { WatchingSnapshot } from './mcp-event-catalog.ts';
import { normalizeCallbackUrl, validateCallbackUrl, validateSigningSecret, WebhookError } from './mcp-webhook.ts';

const secret = `whsec_${Buffer.alloc(32, 1).toString('base64')}`;
const replacement = `whsec_${Buffer.alloc(32, 2).toString('base64')}`;
const idle: WatchingSnapshot = { itemId: null, title: null, paused: null };
const playing = (itemId = 'episode-1', paused = false): WatchingSnapshot => ({ itemId, title: 'Public title', paused });
const params = (path = '/callback', extra: Record<string, unknown> = {}) => ({
  name: 'watching-now',
  delivery: { mode: 'webhook', url: `https://receiver.example.com${path}`, secret },
  ...extra,
});
const cancelParams = (path = '/callback', args?: Record<string, unknown>) => ({
  name: 'watching-now',
  ...(args ? { arguments: args } : {}),
  delivery: { mode: 'webhook', url: `https://receiver.example.com${path}` },
});

function fixture() {
  const db = new DatabaseSync(':memory:');
  let now = Date.parse('2026-10-09T12:00:00Z');
  let alarmAt: number | null = null;
  let snapshot = idle;
  let readError = false;
  let verifies = 0;
  let reads = 0;
  let hosts = ['receiver.example.com'];
  let response = { status: 204 };
  let verify: (() => Promise<void>) | undefined;
  let delivery: (() => Promise<{ status: number }>) | undefined;
  let failInsert = false;
  const principals = new Set(['alice', 'bob']);
  const sent: { subscription: EventSubscription; event: PendingEvent; at: number }[] = [];
  const storage: EventStorage = {
    sql: {
      exec(query, ...bindings) {
        if (failInsert && query.startsWith('INSERT INTO mcp_event_outbox')) throw new Error('Synthetic storage failure');
        const statement = db.prepare(query);
        if (/^\s*select/i.test(query)) return { toArray: () => statement.all(...bindings) };
        statement.run(...bindings);
        return { toArray: () => [] };
      },
    },
    transactionSync(callback) {
      db.exec('BEGIN');
      try {
        const result = callback();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  const io: EventIo = {
    now: () => now,
    allowed: (principal) => principals.has(principal),
    normalizeUrl: normalizeCallbackUrl,
    validateUrl: (url) => validateCallbackUrl(url, hosts),
    validateSecret: (value) => { validateSigningSecret(value); },
    verify: async () => {
      verifies++;
      await verify?.();
    },
    readSnapshot: async () => {
      reads++;
      if (readError) throw new Error('Synthetic upstream failure');
      return snapshot;
    },
    deliver: async (subscription, event) => {
      sent.push({ subscription: structuredClone(subscription), event: structuredClone(event), at: now });
      return delivery ? delivery() : response;
    },
    setAlarm: async (at) => { alarmAt = at; },
  };
  let store = new McpEventStore(storage, io);
  const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
  return {
    db, sent, principals,
    get store() { return store; },
    get now() { return now; },
    get alarmAt() { return alarmAt; },
    get verifies() { return verifies; },
    get reads() { return reads; },
    get subscriptions() { return count('mcp_event_subscriptions'); },
    get pending() { return count('mcp_event_outbox'); },
    get sample() { return JSON.parse(db.prepare('SELECT value FROM mcp_event_sample').get()!.value as string); },
    advance: (ms: number = MCP_EVENT_LIMITS.sampleMs) => { now += ms; },
    state: (value: WatchingSnapshot) => { snapshot = value; },
    readFailure: (value: boolean) => { readError = value; },
    verification: (value?: () => Promise<void>) => { verify = value; },
    delivery: (value?: () => Promise<{ status: number }>) => { delivery = value; },
    status: (value: number) => { response = { status: value }; },
    allowHosts: (value: string[]) => { hosts = value; },
    failInsert: (value: boolean) => { failInsert = value; },
    restart: () => { store = new McpEventStore(storage, io); },
  };
}

test('subscribe persists a deterministic principal-scoped identity and finite grants across restart', async () => {
  const f = fixture();
  const first = await f.store.subscribe('alice', params());
  assert.equal(first.cursor, null);
  assert.equal(first.truncated, false);
  assert.equal(Date.parse(first.refreshBefore as string), f.now + MCP_EVENT_LIMITS.defaultTtlMs);
  assert.equal(f.alarmAt, f.now + 1);
  f.restart();
  const renewed = await f.store.subscribe('alice', params('/callback', { arguments: {}, ttlMs: null, maxAgeMs: 12345 }));
  assert.equal(renewed.id, first.id);
  assert.equal(Date.parse(renewed.refreshBefore as string), f.now + MCP_EVENT_LIMITS.maxTtlMs);
  assert.equal(f.subscriptions, 1);
  assert.equal(f.verifies, 1);
  const other = await f.store.subscribe('bob', params());
  assert.notEqual(other.id, first.id);
  assert.equal(f.verifies, 2);
  await f.store.unsubscribe('bob', cancelParams());
  assert.equal(f.subscriptions, 1);
});

test('verification failure leaves existing subscription, expiry and pending delivery unchanged', async () => {
  const f = fixture();
  await f.store.subscribe('alice', params());
  await f.store.alarm();
  f.advance();
  f.state(playing());
  f.status(503);
  await f.store.alarm();
  const old = f.db.prepare('SELECT * FROM mcp_event_subscriptions').get();
  const pending = f.db.prepare('SELECT * FROM mcp_event_outbox').all();
  f.verification(async () => { throw new WebhookError('challenge_failed'); });
  await assert.rejects(f.store.subscribe('alice', params('/callback', { delivery: { mode: 'webhook', url: 'https://receiver.example.com/callback', secret: replacement } })), WebhookError);
  assert.deepEqual(f.db.prepare('SELECT * FROM mcp_event_subscriptions').get(), old);
  assert.deepEqual(f.db.prepare('SELECT * FROM mcp_event_outbox').all(), pending);
});

test('verification cache is principal, URL and secret scoped and expires', async () => {
  const f = fixture();
  await f.store.subscribe('alice', params());
  await f.store.subscribe('alice', params('/callback', { arguments: { change: 'paused' } }));
  assert.equal(f.verifies, 1);
  await f.store.subscribe('alice', params('/other'));
  assert.equal(f.verifies, 2);
  f.advance(MCP_EVENT_LIMITS.verificationCacheMs);
  await f.store.subscribe('alice', params());
  assert.equal(f.verifies, 3);
});

test('first sample and progress/title-only changes emit nothing; transitions use public whitelist', async () => {
  const f = fixture();
  await f.store.subscribe('alice', params());
  await f.store.alarm();
  assert.equal(f.sent.length, 0);
  assert.equal(f.reads, 1);
  await f.store.alarm();
  assert.equal(f.reads, 1);
  f.advance();
  f.state(playing());
  await f.store.alarm();
  const event = JSON.parse(f.sent[0].event.body);
  assert.deepEqual(event.data, { ...playing(), change: 'started', detectedAt: f.now, sequence: 1 });
  assert.deepEqual(Object.keys(event).sort(), ['cursor', 'data', 'eventId', 'name', 'timestamp']);
  assert.equal(event.cursor, null);
  f.advance();
  f.state({ ...playing(), title: 'New public title' });
  await f.store.alarm();
  assert.equal(f.sent.length, 1);
  for (const [snapshot, change] of [[playing('episode-1', true), 'paused'], [playing(), 'resumed'], [playing('episode-2'), 'changed'], [idle, 'stopped']] as const) {
    f.advance();
    f.state(snapshot);
    await f.store.alarm();
    assert.equal(JSON.parse(f.sent.at(-1)!.event.body).data.change, change);
  }
  assert.deepEqual(f.sent.map(({ event }) => JSON.parse(event.body).data.sequence), [1, 2, 3, 4, 5]);
});

test('failed reads preserve baseline and filters apply before outbox creation', async () => {
  const f = fixture();
  await f.store.subscribe('alice', params('/callback', { arguments: { change: 'paused' } }));
  await f.store.alarm();
  f.advance();
  f.state(playing());
  f.readFailure(true);
  await f.store.alarm();
  assert.deepEqual(f.sample.snapshot, idle);
  f.readFailure(false);
  f.advance();
  await f.store.alarm();
  assert.equal(f.sent.length, 0);
  f.advance();
  f.state(playing('episode-1', true));
  await f.store.alarm();
  assert.equal(f.sent.length, 1);
  assert.equal(JSON.parse(f.sent[0].event.body).data.sequence, 2);
});

test('retry keeps identical event ID and body across restart and serializes each subscription', async () => {
  const f = fixture();
  await f.store.subscribe('alice', params());
  await f.store.alarm();
  f.advance();
  f.state(playing());
  f.status(503);
  await f.store.alarm();
  f.restart();
  f.advance();
  f.state(playing('episode-1', true));
  await f.store.alarm();
  assert.equal(f.pending, 2);
  assert.equal(f.sent[0].event.eventId, f.sent[1].event.eventId);
  assert.equal(f.sent[0].event.body, f.sent[1].event.body);
  assert.notEqual(f.sent[0].at, f.sent[1].at);
  f.status(204);
  f.advance();
  await f.store.alarm();
  assert.equal(f.pending, 1);
  await f.store.alarm();
  assert.deepEqual(f.sent.map(({ event }) => event.sequence), [1, 1, 1, 2]);
  assert.equal(f.pending, 0);
});

test('expiration, cancellation and permission revocation delete pending payloads and secrets', async () => {
  for (const stop of ['expire', 'cancel', 'revoke', 'host'] as const) {
    const f = fixture();
    await f.store.subscribe('alice', params('/callback', { ttlMs: 120_000 }));
    await f.store.alarm();
    f.advance();
    f.state(playing());
    f.status(500);
    await f.store.alarm();
    assert.equal(f.pending, 1);
    if (stop === 'expire') f.advance();
    if (stop === 'cancel') {
      await f.store.unsubscribe('alice', cancelParams());
      await f.store.unsubscribe('alice', cancelParams());
    }
    if (stop === 'revoke') f.principals.delete('alice');
    if (stop === 'host') f.allowHosts([]);
    await f.store.alarm();
    if (stop === 'host') await f.store.unsubscribe('alice', cancelParams());
    assert.equal(f.pending, 0, stop);
    assert.equal(f.subscriptions, 0, stop);
    assert.equal(f.alarmAt, null, stop);
    assert.equal(f.sample.snapshot, null, stop);
    assert.equal(f.sent.length, 1, stop);
    assert.equal(f.reads, 2, stop);
  }
});

test('renewal rotates the secret with a bounded old-key window and clears the old key', async () => {
  const f = fixture();
  const first = await f.store.subscribe('alice', params());
  const rotated = await f.store.subscribe('alice', params('/callback', { delivery: { mode: 'webhook', url: 'https://receiver.example.com/callback', secret: replacement } }));
  assert.equal(rotated.id, first.id);
  let row = f.db.prepare('SELECT * FROM mcp_event_subscriptions').get()!;
  assert.equal(row.secret, replacement);
  assert.equal(row.previousSecret, secret);
  assert.equal(row.previousUntil, f.now + MCP_EVENT_LIMITS.rotationMs);
  f.advance(MCP_EVENT_LIMITS.rotationMs);
  await f.store.alarm();
  row = f.db.prepare('SELECT * FROM mcp_event_subscriptions').get()!;
  assert.equal(row.previousSecret, null);
  assert.equal(row.previousUntil, null);
});

test('410, 413 and terminal client errors drop only the delivery; transient failures have bounded attempts', async () => {
  for (const status of [410, 413, 400, 401, 403, 404, 302, 408, 425, 429, 500, 503]) {
    const f = fixture();
    await f.store.subscribe('alice', params());
    await f.store.alarm();
    f.advance();
    f.state(playing());
    f.status(status);
    await f.store.alarm();
    const transient = [408, 425, 429, 500, 503].includes(status);
    assert.equal(f.pending, transient ? 1 : 0, String(status));
    for (let index = 0; index < 5; index++) {
      f.advance();
      await f.store.alarm();
    }
    if (transient && f.pending) {
      f.advance();
      await f.store.alarm();
    }
    assert.equal(f.pending, 0, String(status));
    assert.equal(f.sent.length, transient ? MCP_EVENT_LIMITS.attempts : 1, String(status));
    assert.equal(f.subscriptions, 1, String(status));
  }
});

test('events older than retry window are discarded after offline restart', async () => {
  const f = fixture();
  await f.store.subscribe('alice', params());
  await f.store.alarm();
  f.advance();
  f.state(playing());
  f.status(503);
  await f.store.alarm();
  f.advance(MCP_EVENT_LIMITS.retryWindowMs);
  f.restart();
  await f.store.alarm();
  assert.equal(f.pending, 0);
  assert.equal(f.sent.length, 1);
});

test('delivery concurrency is bounded across subscriptions and cancellation waits for in-flight delivery', async () => {
  const f = fixture();
  for (let index = 0; index < 6; index++) await f.store.subscribe('alice', params(`/callback-${index}`));
  await f.store.alarm();
  f.advance();
  f.state(playing());
  let active = 0;
  let highWater = 0;
  const releases: (() => void)[] = [];
  let started: (() => void) | undefined;
  const allStarted = new Promise<void>((resolve) => { started = resolve; });
  f.delivery(async () => {
    active++;
    highWater = Math.max(active, highWater);
    if (active === MCP_EVENT_LIMITS.deliveryConcurrency) started!();
    await new Promise<void>((resolve) => { releases.push(resolve); });
    active--;
    return { status: 204 };
  });
  const delivering = f.store.alarm();
  await allStarted;
  const canceling = f.store.unsubscribe('alice', cancelParams('/callback-0'));
  assert.equal(f.subscriptions, 6);
  for (const release of releases) release();
  await delivering;
  await canceling;
  assert.equal(highWater, MCP_EVENT_LIMITS.deliveryConcurrency);
  assert.equal(f.subscriptions, 5);
  f.delivery();
  await f.store.alarm();
  assert.equal(f.pending, 0);
  assert.equal(f.sent.filter(({ subscription }) => subscription.url.endsWith('/callback-0')).length, 1);
});

test('maximum schema-sized escaped public fields remain within the bounded delivery body', async () => {
  const f = fixture();
  await f.store.subscribe('alice', params());
  await f.store.alarm();
  f.advance();
  f.state({ itemId: `a${'\u0001'.repeat(1023)}`, title: '\u0001'.repeat(2048), paused: false });
  await f.store.alarm();
  assert.equal(f.sent.length, 1);
  assert.ok(new TextEncoder().encode(f.sent[0].event.body).byteLength < MCP_EVENT_LIMITS.bodyBytes);
});

test('subscription quotas do not verify rejected additions and permit identity refresh', async () => {
  const f = fixture();
  for (let index = 0; index < MCP_EVENT_LIMITS.subscriptionsPerPrincipal; index++) await f.store.subscribe('alice', params(`/callback-${index}`));
  await assert.rejects(f.store.subscribe('alice', params('/overflow')), (error: unknown) => error instanceof EventRpcError && error.code === -32013);
  assert.equal(f.verifies, MCP_EVENT_LIMITS.subscriptionsPerPrincipal);
  await f.store.subscribe('alice', params('/callback-0'));
  for (let owner = 1; owner < 10; owner++) {
    const principal = `owner-${owner}`;
    f.principals.add(principal);
    for (let index = 0; index < 10; index++) await f.store.subscribe(principal, params(`/callback-${index}`));
  }
  await assert.rejects(f.store.subscribe('bob', params()), (error: unknown) => error instanceof EventRpcError && error.code === -32013);
  assert.equal(f.subscriptions, MCP_EVENT_LIMITS.subscriptions);
});

test('authorization is rechecked after verification and serialized unsubscribe cannot resurrect an in-flight subscription', async () => {
  const f = fixture();
  let release: (() => void) | undefined;
  const verificationStarted = new Promise<void>((resolve) => {
    f.verification(async () => {
      resolve();
      await new Promise<void>((done) => { release = done; });
    });
  });
  const subscribing = f.store.subscribe('alice', params());
  await verificationStarted;
  const canceling = f.store.unsubscribe('alice', cancelParams());
  release!();
  await subscribing;
  await canceling;
  assert.equal(f.subscriptions, 0);
  f.verification(async () => { f.principals.delete('alice'); });
  await assert.rejects(f.store.subscribe('alice', params()), (error: unknown) => error instanceof EventRpcError && error.code === -32012);
  assert.equal(f.subscriptions, 0);
});

test('snapshot, sequence and all fanout rows commit atomically', async () => {
  const f = fixture();
  await f.store.subscribe('alice', params());
  await f.store.subscribe('bob', params());
  await f.store.alarm();
  f.advance();
  f.state(playing());
  f.failInsert(true);
  await assert.rejects(f.store.alarm(), /Synthetic storage failure/);
  assert.deepEqual(f.sample.snapshot, idle);
  assert.equal(f.sample.sequence, 0);
  assert.equal(f.pending, 0);
  f.failInsert(false);
  f.advance();
  await f.store.alarm();
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].event.eventId, f.sent[1].event.eventId);
  assert.equal(f.sent[0].event.body, f.sent[1].event.body);
});

test('full outbox drops the newest event without changing queued order or exceeding its bound', async () => {
  const f = fixture();
  const subscription = await f.store.subscribe('alice', params());
  await f.store.alarm();
  for (let sequence = 1; sequence <= MCP_EVENT_LIMITS.pendingPerSubscription; sequence++) {
    f.db.prepare('INSERT INTO mcp_event_outbox VALUES (?, ?, ?, ?, ?, ?, ?)').run(subscription.id as string, `evt_${sequence}`, sequence, '{}', f.now, f.now + 300_000, 0);
  }
  f.advance();
  f.state(playing());
  await f.store.alarm();
  assert.equal(f.pending, MCP_EVENT_LIMITS.pendingPerSubscription);
  assert.deepEqual(f.sample.snapshot, playing());
  assert.equal(f.sent.length, 0);
});

test('wire validation rejects unknown fields, invalid TTL, filters, secrets and unsupported delivery', async () => {
  const f = fixture();
  const invalid = [
    params('/callback', { typo: true }),
    params('/callback', { arguments: { typo: true } }),
    params('/callback', { arguments: null }),
    params('/callback', { ttlMs: -1 }),
    params('/callback', { ttlMs: 0 }),
    params('/callback', { ttlMs: 1.5 }),
    params('/callback', { ttlMs: Infinity }),
    params('/callback', { maxAgeMs: -1 }),
    params('/callback', { cursor: 'unsupported' }),
    params('/callback', { delivery: { mode: 'poll', url: 'https://receiver.example.com', secret } }),
    params('/callback', { delivery: { mode: 'webhook', url: 'https://receiver.example.com', secret, typo: true } }),
    params('/callback', { delivery: { mode: 'webhook', url: 'https://receiver.example.com', secret: 'not-a-secret' } }),
  ];
  for (const value of invalid) await assert.rejects(f.store.subscribe('alice', value));
  await assert.rejects(f.store.unsubscribe('alice', { ...cancelParams(), id: 'not-a-wire-identity' }));
  await assert.rejects(f.store.subscribe('unknown', params()), (error: unknown) => error instanceof EventRpcError && error.code === -32012);
  assert.equal(f.verifies, 0);
  assert.equal(f.subscriptions, 0);
  const short = await f.store.subscribe('alice', params('/callback', { ttlMs: 1234 }));
  assert.equal(Date.parse(short.refreshBefore as string), f.now + 1234);
});
