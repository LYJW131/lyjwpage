import {
  EVENT_NAME,
  detectWatchingChange,
  matchesEventArguments,
  parseEventArguments,
  snapshotKey,
  type EventArguments,
  type WatchingSnapshot,
} from './mcp-event-catalog';
import { EventRpcError } from './mcp-event-errors';

export const MCP_EVENT_LIMITS = {
  defaultTtlMs: 60 * 60_000,
  maxTtlMs: 24 * 60 * 60_000,
  sampleMs: 60_000,
  verificationCacheMs: 5 * 60_000,
  rotationMs: 5 * 60_000,
  subscriptions: 100,
  subscriptionsPerPrincipal: 10,
  pendingPerSubscription: 32,
  deliveryConcurrency: 4,
  attempts: 5,
  retryWindowMs: 10 * 60_000,
  bodyBytes: 32 * 1024,
} as const;

export interface EventStorage {
  sql: { exec(query: string, ...bindings: (string | number | null)[]): { toArray(): Record<string, unknown>[] } };
  transactionSync<T>(callback: () => T): T;
}

export type EventSubscription = {
  id: string;
  principal: string;
  url: string;
  args: string;
  secret: string;
  previousSecret: string | null;
  previousUntil: number | null;
  expiresAt: number;
  verifiedAt: number;
};

export type PendingEvent = {
  subscriptionId: string;
  eventId: string;
  sequence: number;
  body: string;
  createdAt: number;
  nextAttemptAt: number;
  attempts: number;
};

export interface EventIo {
  now(): number;
  allowed(principal: string): boolean;
  normalizeUrl(url: string): string;
  validateUrl(url: string): string;
  validateSecret(secret: string): void;
  verify(subscription: EventSubscription): Promise<void>;
  readSnapshot(): Promise<WatchingSnapshot>;
  deliver(subscription: EventSubscription, event: PendingEvent): Promise<{ status: number; retryAfterMs?: number }>;
  setAlarm(at: number | null): Promise<void>;
}

type SampleState = { snapshot: WatchingSnapshot | null; sequence: number; nextSampleAt: number };
type Identity = { id: string; principal: string; url: string; args: string };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EventRpcError(-32602, 'Invalid event parameters');
  return value as Record<string, unknown>;
}

function duration(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (value === null) return MCP_EVENT_LIMITS.maxTtlMs;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new EventRpcError(-32602, 'Invalid ttlMs');
  return Math.min(value, MCP_EVENT_LIMITS.maxTtlMs);
}

function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new EventRpcError(-32602, 'Unknown event parameter');
}

export class McpEventStore {
  private readonly storage: EventStorage;
  private readonly io: EventIo;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(storage: EventStorage, io: EventIo) {
    this.storage = storage;
    this.io = io;
    storage.sql.exec('CREATE TABLE IF NOT EXISTS mcp_event_subscriptions (id TEXT PRIMARY KEY, principal TEXT NOT NULL, url TEXT NOT NULL, args TEXT NOT NULL, secret TEXT NOT NULL, previousSecret TEXT, previousUntil INTEGER, expiresAt INTEGER NOT NULL, verifiedAt INTEGER NOT NULL)');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS mcp_event_subscriptions_principal ON mcp_event_subscriptions (principal)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS mcp_event_outbox (subscriptionId TEXT NOT NULL, eventId TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL, createdAt INTEGER NOT NULL, nextAttemptAt INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY (subscriptionId, eventId))');
    storage.sql.exec('CREATE INDEX IF NOT EXISTS mcp_event_outbox_sequence ON mcp_event_outbox (subscriptionId, sequence)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS mcp_event_sample (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)');
    storage.sql.exec('INSERT OR IGNORE INTO mcp_event_sample (id, value) VALUES (1, ?)', JSON.stringify({ snapshot: null, sequence: 0, nextSampleAt: 0 }));
  }

  private rows(query: string, ...bindings: (string | number | null)[]): Record<string, unknown>[] {
    return this.storage.sql.exec(query, ...bindings).toArray();
  }

  private subscriptions(): EventSubscription[] {
    return this.rows('SELECT * FROM mcp_event_subscriptions') as EventSubscription[];
  }

  private sampleState(): SampleState {
    return JSON.parse(this.rows('SELECT value FROM mcp_event_sample WHERE id = 1')[0].value as string) as SampleState;
  }

  private saveSample(state: SampleState): void {
    this.storage.sql.exec('UPDATE mcp_event_sample SET value = ? WHERE id = 1', JSON.stringify(state));
  }

  private remove(id: string): void {
    this.storage.sql.exec('DELETE FROM mcp_event_outbox WHERE subscriptionId = ?', id);
    this.storage.sql.exec('DELETE FROM mcp_event_subscriptions WHERE id = ?', id);
  }

  private prune(): void {
    const now = this.io.now();
    this.storage.transactionSync(() => {
      for (const subscription of this.subscriptions()) {
        let callbackAllowed = true;
        try {
          this.io.validateUrl(subscription.url);
        } catch {
          callbackAllowed = false;
        }
        if (subscription.expiresAt <= now || !this.io.allowed(subscription.principal) || !callbackAllowed) this.remove(subscription.id);
      }
      this.storage.sql.exec('UPDATE mcp_event_subscriptions SET previousSecret = NULL, previousUntil = NULL WHERE previousUntil <= ?', now);
      this.storage.sql.exec('DELETE FROM mcp_event_outbox WHERE createdAt <= ? OR attempts >= ?', now - MCP_EVENT_LIMITS.retryWindowMs, MCP_EVENT_LIMITS.attempts);
      if (!this.subscriptions().length) {
        const sample = this.sampleState();
        this.saveSample({ ...sample, snapshot: null, nextSampleAt: 0 });
      }
    });
  }

  private authorize(principal: string): void {
    if (!this.io.allowed(principal)) throw new EventRpcError(-32012, 'Event access denied');
  }

  private grantExpiration(ttl: number, credentialExpiresAt?: number): number {
    const now = this.io.now();
    if (credentialExpiresAt !== undefined && (!Number.isSafeInteger(credentialExpiresAt) || credentialExpiresAt <= now)) {
      throw new EventRpcError(-32012, 'Event credential expired or invalid');
    }
    return Math.min(now + ttl, credentialExpiresAt ?? Infinity);
  }

  private async identity(principal: string, value: unknown, requireAllowed = true): Promise<Identity> {
    const params = object(value);
    if (params.name !== EVENT_NAME) throw new EventRpcError(-32011, 'Unknown event');
    let args: string;
    try {
      args = JSON.stringify(parseEventArguments(params.arguments));
    } catch {
      throw new EventRpcError(-32602, 'Invalid event arguments');
    }
    const delivery = object(params.delivery);
    if (delivery.mode !== undefined && delivery.mode !== 'webhook') throw new EventRpcError(-32014, 'Only webhook delivery is supported');
    if (typeof delivery.url !== 'string' || delivery.url.length > 2048) throw new EventRpcError(-32602, 'Invalid callback URL');
    const url = requireAllowed ? this.io.validateUrl(delivery.url) : this.io.normalizeUrl(delivery.url);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([principal, url, EVENT_NAME, args])));
    const id = `sub_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    return { id, principal, url, args };
  }

  private assertCapacity(identity: Identity): void {
    const subscriptions = this.subscriptions();
    if (subscriptions.some((subscription) => subscription.id === identity.id)) return;
    if (subscriptions.length >= MCP_EVENT_LIMITS.subscriptions
      || subscriptions.filter((subscription) => subscription.principal === identity.principal).length >= MCP_EVENT_LIMITS.subscriptionsPerPrincipal) {
      throw new EventRpcError(-32013, 'Event subscription limit reached');
    }
  }

  private async schedule(): Promise<void> {
    const subscriptions = this.subscriptions();
    if (!subscriptions.length) return this.io.setAlarm(null);
    const next = [this.sampleState().nextSampleAt, ...subscriptions.map((subscription) => subscription.expiresAt)];
    for (const row of this.heads()) next.push(row.nextAttemptAt);
    await this.io.setAlarm(Math.max(this.io.now() + 1, Math.min(...next)));
  }

  private run<T>(callback: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      try {
        this.prune();
        return await callback();
      } finally {
        await this.schedule();
      }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  subscribe(principal: string, value: unknown, credentialExpiresAt?: number): Promise<Record<string, unknown>> {
    return this.run(async () => {
      this.authorize(principal);
      const params = object(value);
      keys(params, ['name', 'arguments', 'delivery', 'cursor', 'maxAgeMs', 'ttlMs', '_meta']);
      const delivery = object(params.delivery);
      keys(delivery, ['mode', 'url', 'secret']);
      if (delivery.mode !== 'webhook') throw new EventRpcError(-32014, 'Only webhook delivery is supported');
      if (params.cursor !== undefined && params.cursor !== null) throw new EventRpcError(-32014, 'Event replay is not supported');
      if (params.maxAgeMs !== undefined && (typeof params.maxAgeMs !== 'number' || !Number.isSafeInteger(params.maxAgeMs) || params.maxAgeMs < 0)) {
        throw new EventRpcError(-32602, 'Invalid maxAgeMs');
      }
      const ttl = duration(params.ttlMs, MCP_EVENT_LIMITS.defaultTtlMs);
      const expiresAt = this.grantExpiration(ttl, credentialExpiresAt);
      const identity = await this.identity(principal, params);
      if (typeof delivery.secret !== 'string') throw new EventRpcError(-32602, 'Invalid webhook signing secret');
      this.io.validateSecret(delivery.secret);
      this.assertCapacity(identity);
      const old = this.subscriptions().find((subscription) => subscription.id === identity.id);
      const now = this.io.now();
      const cached = this.subscriptions().find((subscription) => subscription.principal === principal
        && subscription.url === identity.url && subscription.secret === delivery.secret
        && subscription.verifiedAt > now - MCP_EVENT_LIMITS.verificationCacheMs);
      const subscription: EventSubscription = {
        ...identity,
        secret: delivery.secret,
        previousSecret: old && old.secret !== delivery.secret ? old.secret : old?.previousSecret ?? null,
        previousUntil: old && old.secret !== delivery.secret ? now + MCP_EVENT_LIMITS.rotationMs : old?.previousUntil ?? null,
        expiresAt,
        verifiedAt: cached?.verifiedAt ?? now,
      };
      if (!cached) await this.io.verify(subscription);
      this.authorize(principal);
      subscription.expiresAt = this.grantExpiration(ttl, credentialExpiresAt);
      this.prune();
      this.assertCapacity(identity);
      if (!cached) subscription.verifiedAt = this.io.now();
      if (old && old.expiresAt <= this.io.now()) {
        subscription.previousSecret = null;
        subscription.previousUntil = null;
      }
      if (old?.secret !== delivery.secret && subscription.previousSecret) subscription.previousUntil = this.io.now() + MCP_EVENT_LIMITS.rotationMs;
      this.storage.transactionSync(() => {
        this.storage.sql.exec('INSERT OR REPLACE INTO mcp_event_subscriptions (id, principal, url, args, secret, previousSecret, previousUntil, expiresAt, verifiedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          subscription.id, principal, subscription.url, subscription.args, subscription.secret,
          subscription.previousSecret, subscription.previousUntil, subscription.expiresAt, subscription.verifiedAt);
      });
      return { id: subscription.id, refreshBefore: new Date(subscription.expiresAt).toISOString(), cursor: null, truncated: false };
    });
  }

  unsubscribe(principal: string, value: unknown): Promise<Record<string, unknown>> {
    return this.run(async () => {
      this.authorize(principal);
      const params = object(value);
      keys(params, ['name', 'arguments', 'delivery', '_meta']);
      keys(object(params.delivery), ['mode', 'url']);
      const identity = await this.identity(principal, params, false);
      this.storage.transactionSync(() => this.remove(identity.id));
      this.prune();
      return {};
    });
  }

  private heads(): PendingEvent[] {
    return this.rows('SELECT o.* FROM mcp_event_outbox o WHERE NOT EXISTS (SELECT 1 FROM mcp_event_outbox earlier WHERE earlier.subscriptionId = o.subscriptionId AND earlier.sequence < o.sequence) ORDER BY o.nextAttemptAt, o.sequence') as PendingEvent[];
  }

  private async sample(): Promise<void> {
    const state = this.sampleState();
    const now = this.io.now();
    if (state.nextSampleAt > now || !this.subscriptions().length) return;
    this.saveSample({ ...state, nextSampleAt: now + MCP_EVENT_LIMITS.sampleMs });
    let snapshot: WatchingSnapshot;
    try {
      snapshot = await this.io.readSnapshot();
    } catch {
      return;
    }
    this.prune();
    if (!this.subscriptions().length) return;
    const detectedAt = this.io.now();
    const changed = state.snapshot !== null && snapshotKey(state.snapshot) !== snapshotKey(snapshot);
    const sequence = changed ? state.sequence + 1 : state.sequence;
    const payload = changed ? detectWatchingChange(state.snapshot!, snapshot, detectedAt, sequence) : null;
    const eventId = `evt_${crypto.randomUUID()}`;
    const body = payload ? JSON.stringify({ eventId, name: EVENT_NAME, timestamp: new Date(detectedAt).toISOString(), data: payload, cursor: null }) : null;
    if (body && new TextEncoder().encode(body).byteLength > MCP_EVENT_LIMITS.bodyBytes) return;
    this.storage.transactionSync(() => {
      this.saveSample({ snapshot, sequence, nextSampleAt: detectedAt + MCP_EVENT_LIMITS.sampleMs });
      if (!body || !payload) return;
      for (const subscription of this.subscriptions()) {
        if (!matchesEventArguments(JSON.parse(subscription.args) as EventArguments, payload)) continue;
        const count = Number(this.rows('SELECT COUNT(*) AS n FROM mcp_event_outbox WHERE subscriptionId = ?', subscription.id)[0].n);
        if (count >= MCP_EVENT_LIMITS.pendingPerSubscription) continue;
        this.storage.sql.exec('INSERT INTO mcp_event_outbox (subscriptionId, eventId, sequence, body, createdAt, nextAttemptAt, attempts) VALUES (?, ?, ?, ?, ?, ?, 0)',
          subscription.id, eventId, sequence, body, detectedAt, detectedAt);
      }
    });
  }

  private async attempt(event: PendingEvent): Promise<void> {
    const subscription = this.subscriptions().find((candidate) => candidate.id === event.subscriptionId);
    if (!subscription || !this.io.allowed(subscription.principal) || subscription.expiresAt <= this.io.now()) return;
    const attempts = event.attempts + 1;
    const retryDelay = Math.min(15_000 * 2 ** event.attempts, 120_000);
    this.storage.sql.exec('UPDATE mcp_event_outbox SET attempts = ?, nextAttemptAt = ? WHERE subscriptionId = ? AND eventId = ?',
      attempts, this.io.now() + retryDelay, event.subscriptionId, event.eventId);
    let response: { status: number; retryAfterMs?: number };
    try {
      response = await this.io.deliver(subscription, event);
    } catch {
      response = { status: 0 };
    }
    const retryable = response.status === 0 || [408, 425, 429].includes(response.status) || response.status >= 500;
    const withinWindow = this.io.now() < event.createdAt + MCP_EVENT_LIMITS.retryWindowMs;
    if (!retryable || attempts >= MCP_EVENT_LIMITS.attempts || !withinWindow) {
      this.storage.sql.exec('DELETE FROM mcp_event_outbox WHERE subscriptionId = ? AND eventId = ?', event.subscriptionId, event.eventId);
      return;
    }
    const retryAfter = Number.isFinite(response.retryAfterMs) ? Math.max(0, Math.min(response.retryAfterMs!, 120_000)) : 0;
    this.storage.sql.exec('UPDATE mcp_event_outbox SET nextAttemptAt = ? WHERE subscriptionId = ? AND eventId = ?',
      Math.min(event.createdAt + MCP_EVENT_LIMITS.retryWindowMs, this.io.now() + Math.max(retryDelay, retryAfter)), event.subscriptionId, event.eventId);
  }

  alarm(): Promise<void> {
    return this.run(async () => {
      await this.sample();
      this.prune();
      const due = this.heads().filter((event) => event.nextAttemptAt <= this.io.now()).slice(0, MCP_EVENT_LIMITS.deliveryConcurrency);
      await Promise.all(due.map((event) => this.attempt(event)));
      this.prune();
    });
  }
}
