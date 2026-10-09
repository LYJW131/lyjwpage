import { WorkerEntrypoint } from 'cloudflare:workers';

const cancellations = new Set();

export class Verification extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__verify/public-status') {
      return this.env.PUBLIC_STATUS.readStatus(url.searchParams.get('path') ?? '');
    }
    if (url.pathname === '/__verify/cancellations') {
      return Response.json([...cancellations]);
    }
    if (url.pathname === '/__verify/cancel') {
      const controller = new AbortController();
      const target = url.searchParams.has('direct') ? this.env.FIXTURE : this.env.GATEWAY;
      const response = await target.fetch(`http://gateway/api/chat?mode=hold&id=${url.searchParams.get('id')}`, { method: 'POST', signal: controller.signal });
      const reader = response.body.getReader();
      await reader.read();
      await reader.cancel('verification complete');
      controller.abort();
      // Keep this invocation alive while workerd delivers cancellation to the downstream handler.
      await new Promise(resolve => setTimeout(resolve, 100));
      return new Response(null, { status: 204 });
    }
    return this.env.GATEWAY.fetch(new Request(new URL(`/api/chat${url.search}`, 'http://gateway'), request));
  }
}

const fixture = {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.searchParams.get('mode') === 'error') {
      return Response.json({ error: 'fixture quota exhausted' }, {
        status: 429,
        headers: { 'Retry-After': '17', 'Cache-Control': 'no-store', 'X-AI-Fixture': 'error' },
      });
    }
    const body = await request.text();
    const encoder = new TextEncoder();
    const line = event => encoder.encode(`${JSON.stringify(event)}\n`);
    const hold = url.searchParams.get('mode') === 'hold';
    const id = url.searchParams.get('id');
    request.signal.addEventListener('abort', () => cancellations.add(id), { once: true });
    let timer;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(line({ type: 'route', route: 'haiku', tier: 'haiku' }));
        timer = setInterval(() => {
          controller.enqueue(line({ type: 'text', text: body || 'fixture text' }));
          if (!hold) {
            clearInterval(timer);
            controller.close();
          }
        }, 500);
      },
      cancel() {
        clearInterval(timer);
        cancellations.add(id);
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-AI-Fixture': 'stream',
        'X-Observed-Origin': request.headers.get('Origin') ?? '',
        'X-Observed-Client-IP': request.headers.get('CF-Connecting-IP') ?? '',
        'X-Observed-MCP-Protocol': request.headers.get('MCP-Protocol-Version') ?? '',
      },
    });
  },
};

export default fixture;
