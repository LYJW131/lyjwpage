import { DurableObject } from 'cloudflare:workers';

import { eventCallbackHosts, eventPrincipalAllowed } from './mcp-event-auth';
import { readWatchingSnapshot, WATCHING_STATUS_PATH } from './mcp-event-catalog';
import { EventRpcError, type EventRpcReply } from './mcp-event-errors';
import { McpEventStore, type EventIo } from './mcp-event-store';
import { normalizeCallbackUrl, signWebhook, validateCallbackUrl, validateSigningSecret, verifyCallback, webhookPost, WebhookError, type WebhookPost } from './mcp-webhook';
import type { Env } from './runtime';

const STATUS_TIMEOUT_MS = 5_000;
const STATUS_RESPONSE_BYTES = 64 * 1024;

export class McpEventHub extends DurableObject<Env> {
  protected readonly store: McpEventStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new McpEventStore(ctx.storage, this.createIo());
  }

  protected eventNow(): number {
    return Date.now();
  }

  protected postWebhook(...args: Parameters<WebhookPost>): ReturnType<WebhookPost> {
    return webhookPost(...args);
  }

  protected createIo(): EventIo {
    return {
      now: () => this.eventNow(),
      allowed: (principal) => eventPrincipalAllowed(principal, this.env),
      normalizeUrl: normalizeCallbackUrl,
      validateUrl: (url) => validateCallbackUrl(url, eventCallbackHosts(this.env)),
      validateSecret: (secret) => { validateSigningSecret(secret); },
      verify: (subscription) => verifyCallback(subscription.url, subscription.secret, subscription.id, {
        post: (...args) => this.postWebhook(...args),
        now: () => this.eventNow(),
      }),
      readSnapshot: async () => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let expired = false;
        try {
          return await Promise.race([
            (async () => {
              const response = await this.env.PUBLIC_STATUS.readStatus(WATCHING_STATUS_PATH);
              if (!response.ok) throw new Error('Public watching status unavailable');
              if (expired) {
                await response.body?.cancel();
                throw new Error('Public watching status timed out');
              }
              reader = response.body?.getReader();
              if (!reader) throw new Error('Public watching status unavailable');
              const chunks: Uint8Array[] = [];
              let length = 0;
              try {
                for (;;) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  length += value.byteLength;
                  if (length > STATUS_RESPONSE_BYTES) throw new Error('Public watching status too large');
                  chunks.push(value);
                }
              } finally {
                await reader.cancel();
              }
              const bytes = new Uint8Array(length);
              let offset = 0;
              for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
              }
              return readWatchingSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
            })(),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                expired = true;
                void reader?.cancel().catch(() => undefined);
                reject(new Error('Public watching status timed out'));
              }, STATUS_TIMEOUT_MS);
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
      },
      deliver: async (subscription, event) => {
        const url = validateCallbackUrl(subscription.url, eventCallbackHosts(this.env));
        const timestamp = Math.floor(this.eventNow() / 1000);
        const signatures = [await signWebhook(subscription.secret, event.eventId, timestamp, event.body)];
        if (subscription.previousSecret && subscription.previousUntil && subscription.previousUntil > this.eventNow()) {
          signatures.push(await signWebhook(subscription.previousSecret, event.eventId, timestamp, event.body));
        }
        return this.postWebhook(url, {
          'Content-Type': 'application/json',
          'webhook-id': event.eventId,
          'webhook-timestamp': String(timestamp),
          'webhook-signature': signatures.join(' '),
          'X-MCP-Subscription-Id': subscription.id,
        }, event.body);
      },
      setAlarm: async (at) => {
        if (at === null) await this.ctx.storage.deleteAlarm();
        else await this.ctx.storage.setAlarm(at);
      },
    };
  }

  private async reply(action: () => Promise<Record<string, unknown>>): Promise<EventRpcReply> {
    try {
      return { result: await action() };
    } catch (error) {
      if (error instanceof EventRpcError) return { error: { code: error.code, message: error.message, ...(error.data ? { data: error.data } : {}) } };
      if (error instanceof WebhookError) {
        if (['invalid_secret', 'invalid_url', 'host_not_allowed'].includes(error.reason)) return { error: { code: -32602, message: 'Invalid webhook delivery parameters' } };
        const reason = error.reason === 'timeout' ? 'timeout'
          : ['dns_failed', 'connection_failed'].includes(error.reason) ? 'connection_refused' : 'challenge_failed';
        return { error: { code: -32015, message: 'Webhook callback rejected', data: { reason } } };
      }
      return { error: { code: -32603, message: 'Event operation failed' } };
    }
  }

  subscribe(principal: string, params: unknown): Promise<EventRpcReply> {
    return this.reply(() => this.store.subscribe(principal, params));
  }

  unsubscribe(principal: string, params: unknown): Promise<EventRpcReply> {
    return this.reply(() => this.store.unsubscribe(principal, params));
  }

  alarm(): Promise<void> {
    return this.store.alarm();
  }
}
