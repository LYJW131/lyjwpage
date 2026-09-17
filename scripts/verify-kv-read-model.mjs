#!/usr/bin/env node
/** Isolated workerd/DO SQLite/KV integration. No production configuration or credentials. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'workers/api/package.json'));
const temporary = await mkdtemp(join(tmpdir(), 'lyjw-kv-verify-'));
const logs = [];
let child;
let startupError;
const secret = 'isolated-kv-test';
const prefix = 'isolated-kv';
const path = '/api/status/watching';
const key = `${prefix}:public-read-model:v1:${path}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
async function freePort() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function eventually(check) {
  const deadline = Date.now() + 90_000;
  let failure;
  do {
    if (startupError) throw startupError;
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`Wrangler exited before verification: ${child.exitCode ?? child.signalCode}`);
    }
    try { return await check(); } catch (error) { failure = error; }
    await sleep(200);
  } while (Date.now() < deadline);
  throw failure;
}
try {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // Test-only harness is generated outside the repo. It never ships with the Worker.
  const harness = join(temporary, 'harness.ts');
  await writeFile(harness, `
import worker, { LivePushRoom, StateHub } from ${JSON.stringify(join(root, 'workers/api/src/index.ts'))};
export { LivePushRoom, StateHub };
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__test/kv') {
      const key = url.searchParams.get('key');
      if (request.method === 'PUT') { await env.READ_MODEL.put(key, await request.text()); return new Response('ok'); }
      return Response.json(await env.READ_MODEL.get(key, 'json'));
    }
    if (request.headers.get('X-Test-KV-Failure') === '1') {
      env = { ...env, READ_MODEL: { get: async () => { throw new Error('injected KV read failure'); } } };
    }
    return worker.fetch(request, env, ctx);
  },
  scheduled: worker.scheduled,
};`);
  const config = {
    name: 'isolated-kv-read-model', main: harness,
    // Wrangler 3 joins this field to its config directory; absolute paths are not safe here.
    tsconfig: relative(temporary, join(root, 'workers/api/tsconfig.json')),
    compatibility_date: '2025-02-14',
    compatibility_flags: ['nodejs_compat', 'nodejs_compat_populate_process_env'],
    vars: {
      STORAGE_PREFIX: prefix, TELEMETRY_INGEST_SECRET: secret, STATE_IMPORT_SECRET: `${secret}-import`,
      ALLOWED_ORIGINS: 'https://allowed.example', SITE_URL: '', EMBY_PUBLIC_URL: '',
      DEV_OVERRIDES: 'false', UPSTREAM_API_URL: '',
    },
    alias: { '@/lib/storage-driver': join(root, 'workers/api/src/storage-driver.ts') },
    durable_objects: { bindings: [
      { name: 'LIVE_PUSH', class_name: 'LivePushRoom' },
      { name: 'STATE', class_name: 'StateHub' },
    ] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['LivePushRoom', 'StateHub'] }],
    // Local-only test ID. No --remote and no production namespace is ever used.
    kv_namespaces: [{ binding: 'READ_MODEL', id: '00000000000000000000000000000001' }],
    r2_buckets: [{ binding: 'IMAGES', bucket_name: 'isolated-images' }],
  };
  const configPath = join(temporary, 'wrangler.json');
  await writeFile(configPath, JSON.stringify(config));
  child = spawn(process.execPath, [require.resolve('wrangler'), 'dev', '--config', configPath, '--port', String(port), '--persist-to', join(temporary, 'state')], {
    cwd: root, env: { ...process.env, WRANGLER_LOG_PATH: join(temporary, 'wrangler.log') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('error', error => { startupError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', value => logs.push(value.toString()));
  const post = (target, value, token = secret) => request(`${base}${target}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  await eventually(async () => assert.equal((await request(`${base}/count`)).status, 200));
  assert.equal((await post('/api/internal/storage/import', {
    entries: [{ key: `${prefix}:private:test-only`, kind: 'string', value: 'do-not-project-this-secret', expiresAt: null }], finalize: true,
  }, `${secret}-import`)).status, 200);
  assert.equal((await post('/api/ingest/emby', { resume: { items: [{ id: 'one', name: 'KV integration movie', type: 'Movie' }] } })).status, 202);
  await eventually(async () => {
    const response = await request(`${base}${path}`);
    assert.equal(response.headers.get('x-read-model'), 'kv');
    assert.match(await response.text(), /KV integration movie/);
  });
  console.log('PASS: ingest -> authoritative DO -> durable alarm -> KV -> edge hit');
  const inspect = `${base}/__test/kv?key=${encodeURIComponent(key)}`;
  const projection = await (await request(inspect)).json();
  assert.equal(projection.schema, 1);
  assert.equal(JSON.stringify(projection).includes('do-not-project-this-secret'), false);
  const fresh = await request(`${base}${path}?fresh=1`);
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.headers.get('x-read-model'), 'kv');
  assert.match(await fresh.text(), /KV integration movie/);
  const live = await request(`${base}/api/status/watching/now`);
  assert.notEqual(live.headers.get('x-read-model'), 'kv');
  const denied = await request(`${base}${path}`, { headers: { Origin: 'https://rejected.example' } });
  assert.equal(denied.status, 403);
  const allowed = await request(`${base}${path}`, { headers: { Origin: 'https://allowed.example' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example');
  assert.equal((await post(path, {})).status, 405);
  console.log('PASS: fresh/live bypass, CORS, methods, private data isolation');
  // A stale or unavailable projection must not turn a healthy backend into an outage.
  // Respect the actual platform's same-key write limit even in the local emulator.
  await sleep(1_100);
  assert.equal((await request(inspect, { method: 'PUT', body: JSON.stringify({ ...projection, generatedAt: 0 }) })).status, 200);
  await eventually(async () => {
    const response = await request(`${base}${path}`);
    assert.equal(response.headers.get('x-read-model'), 'origin');
    assert.match(await response.text(), /KV integration movie/);
  });
  const unavailable = await request(`${base}${path}`, { headers: { 'X-Test-KV-Failure': '1' } });
  assert.equal(unavailable.status, 200);
  assert.equal(unavailable.headers.get('x-read-model'), 'origin');
  console.log('PASS: stale and failed KV fall back to authoritative reads');
} catch (error) {
  console.error(logs.join('').slice(-16000));
  throw error;
} finally {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    await Promise.race([exited, sleep(3000).then(() => child.kill('SIGKILL'))]);
  }
  await rm(temporary, { recursive: true, force: true });
}
