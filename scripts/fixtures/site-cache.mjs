import { WorkerEntrypoint } from 'cloudflare:workers';

export class SiteCache extends WorkerEntrypoint {
  async invalidate(tags) {
    await fetch(this.env.RECORDER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5_000),
    });
  }
}

export default {
  fetch() {
    return new Response('site-cache fixture');
  },
};
