import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { McpEventHub as ProductionMcpEventHub } from '../../workers/ai/src/mcp-event-hub';

const receiver = env => env.MCP_EVENT_TEST_RECEIVER.get(env.MCP_EVENT_TEST_RECEIVER.idFromName('receiver'));

export function installEventJwks(jwksUrl, jwks) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== jwksUrl) return originalFetch(input, init);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method !== 'GET') return Promise.resolve(new Response(null, { status: 405 }));
    return Promise.resolve(Response.json(jwks, { headers: { 'Cache-Control': 'public, max-age=60' } }));
  };
}

export class McpEventHub extends ProductionMcpEventHub {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => { this.clockOffset = await ctx.storage.get('test_clock_offset') ?? 0; });
  }

  eventNow() {
    return Date.now() + (this.clockOffset ?? 0);
  }

  createIo() {
    return { ...super.createIo(), setAlarm: at => this.ctx.storage.put('test_scheduled_alarm', at) };
  }

  async postWebhook(url, headers, body) {
    const response = await receiver(this.env).fetch(new Request(url, { method: 'POST', headers, body }));
    return { status: response.status, body: await response.text() };
  }

  async advance(milliseconds) {
    this.clockOffset += milliseconds;
    await this.ctx.storage.put('test_clock_offset', this.clockOffset);
    await this.alarm();
  }
}

export class McpEventTestReceiver extends DurableObject {
  async fetch(request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url);
      if (url.origin === 'http://fixture') {
        if (url.pathname === '/records') return Response.json(await this.ctx.storage.get('records') ?? []);
        if (url.pathname === '/configure') {
          const configuration = await request.json();
          await this.ctx.storage.put(`configuration:${configuration.path}`, configuration);
          return Response.json({ ok: true });
        }
        return new Response(null, { status: 404 });
      }
      const body = await request.text();
      const records = await this.ctx.storage.get('records') ?? [];
      const payload = JSON.parse(body);
      const configuration = await this.ctx.storage.get(`configuration:${url.pathname}`) ?? {};
      const verification = payload.type === 'verification';
      const status = verification ? 200 : configuration.statuses?.shift() ?? 204;
      records.push({ url: request.url, headers: Object.fromEntries(request.headers), body, status });
      await this.ctx.storage.put('records', records);
      await this.ctx.storage.put(`configuration:${url.pathname}`, configuration);
      if (verification) return Response.json({ challenge: configuration.badChallenge ? 'wrong-challenge' : payload.challenge });
      return new Response(null, { status });
    });
  }
}

export class EventVerification extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    const operation = url.pathname.slice('/__verify/mcp-events/'.length);
    if (operation === 'advance') {
      const { milliseconds } = await request.json();
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return new Response(null, { status: 400 });
      await this.env.MCP_EVENTS.get(this.env.MCP_EVENTS.idFromName('mcp-events-v1')).advance(milliseconds);
      return Response.json({ ok: true });
    }
    if (operation === 'records' || operation === 'configure') {
      return receiver(this.env).fetch(new Request(`http://fixture/${operation}`, request));
    }
    return new Response(null, { status: 404 });
  }
}
