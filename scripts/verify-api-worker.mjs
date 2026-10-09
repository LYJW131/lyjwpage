#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { stripVTControlCharacters } from 'node:util';
import { createDevAccess } from './dev-access.mjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'workers/api/package.json'));
const temporary = await mkdtemp(join(tmpdir(), 'lyjw-ingest-'));
const children = [];
const logs = [];
let socket;
const secret = 'local-token-usage-verification';
const access = await createDevAccess();
const cloudClient = 'cloud-only.access';
const agentsClient = 'agents-only.access';
const macClient = 'mac-only.access';
const questClient = 'quest-only.access';
Object.assign(access.vars.ACCESS_CLIENTS, {
  [cloudClient]: ['ingest:agents-otlp'],
  [agentsClient]: ['ingest:agents'],
  [macClient]: ['ingest:mac'],
  [questClient]: ['ingest:quest'],
});
const verifyBuild = process.argv.includes('--build');
const verifyMcpClient = process.argv.includes('--mcp-client');
const verifyMcpEvents = process.argv.includes('--mcp-events');
const eventToken = 'isolated-mcp-events-primary-token-00000001';
const otherEventToken = 'isolated-mcp-events-secondary-token-00000002';
const callbackHost = 'mcp-events.example.com';
const eventSecret = `whsec_${Buffer.alloc(32, 1).toString('base64')}`;
const rotatedEventSecret = `whsec_${Buffer.alloc(32, 2).toString('base64')}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
function start(command, args, env = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, WRANGLER_LOG_PATH: join(temporary, 'wrangler.log'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => logs.push(data.toString()));
  return child;
}
async function eventually(check) {
  const deadline = Date.now() + 45_000;
  let failure;
  do {
    try { return await check(); } catch (error) { failure = error; }
    await sleep(100);
  } while (Date.now() < deadline);
  throw failure;
}
try {
  const [workerPort, sitePort] = await Promise.all([port(), port()]);
  const worker = `http://127.0.0.1:${workerPort}`;
  const site = `http://127.0.0.1:${sitePort}`;
  const otlpPath = '/api/ingest/agents/otlp';
  const emptyMetrics = JSON.stringify({ resourceMetrics: [] });
  async function otlp(body = emptyMetrics, headers = {}, clientId = cloudClient, path = otlpPath) {
    return fetch(`${worker}${path}`, {
      method: 'POST', headers: { ...await access.headers(clientId), 'content-type': 'application/json', ...headers }, body,
    });
  }
  const musicKitKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const musicKitPem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', musicKitKeys.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
  const kv = [
    { binding: 'LAG', id: '00000000000000000000000000000001' },
    { binding: 'CREDENTIALS', id: '00000000000000000000000000000002' },
  ];
  const apiKv = [...kv, { binding: 'APPLE_CACHE', id: '00000000000000000000000000000003' }];
  // Configs live outside the checkout so Wrangler cannot load real .dev.vars or production bindings.
  const api = {
    name: 'isolated-api', main: join(root, 'workers/api/src/index.ts'),
    compatibility_date: '2025-02-14', compatibility_flags: ['nodejs_compat', 'nodejs_compat_populate_process_env', 'enable_request_signal'],
    vars: {
      NEXT_PUBLIC_BACKEND_URL: worker, STORAGE_PREFIX: 'isolated-verify', STATE_IMPORT_SECRET: `${secret}-import`, REVALIDATE_SECRET: `${secret}-revalidate`,
      SITE_URL: site, ALLOWED_ORIGINS: '',
      DEV_OVERRIDES: 'true',
      APPLE_MUSIC_PRIVATE_KEY: musicKitPem, APPLE_MUSIC_TEAM_ID: 'ISOLATEDTM', APPLE_MUSIC_KEY_ID: 'ISOLATEDKY',
    },
    alias: Object.fromEntries(['storage-driver', 'apple-developer-token', 'apple-music-credentials', 'lag-store', 'apple-cache-store']
      .map(name => [`@/lib/${name}`, join(root, `workers/api/src/${name}.ts`)])),
    durable_objects: { bindings: [
      { name: 'LIVE_PUSH', class_name: 'LivePushRoom' },
      { name: 'STATE', class_name: 'StateHub' },
    ] },
    services: [
      { binding: 'DEV_OVERRIDE_READER', service: 'isolated-api', entrypoint: 'DevOverrideReader' },
      { binding: 'AI_SERVICE', service: 'isolated-ai' },
    ],
    migrations: [
      { tag: 'v1', new_sqlite_classes: ['LivePushRoom'] },
      { tag: 'v3', new_sqlite_classes: ['StateHub'] },
    ],
    kv_namespaces: apiKv,
  };
  const ai = {
    name: 'isolated-ai', main: join(root, 'workers/ai/src/index.ts'),
    compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat', 'nodejs_compat_populate_process_env', 'enable_request_signal'],
    vars: { ALLOWED_ORIGINS: 'https://lyjw.me' },
    services: [{ binding: 'PUBLIC_STATUS', service: 'isolated-api', entrypoint: 'PublicStatus' }],
    durable_objects: { bindings: [
      { name: 'CHAT_QUOTA', class_name: 'ChatQuota' },
      { name: 'ANTHROPIC_EGRESS', class_name: 'AnthropicEgress' },
      { name: 'MCP_EVENTS', class_name: 'McpEventHub' },
    ] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['ChatQuota', 'AnthropicEgress', 'McpEventHub'] }],
  };
  if (verifyMcpEvents) {
    const eventsMain = join(temporary, 'ai-events.mjs');
    await writeFile(eventsMain, `export { default, ChatQuota, AnthropicEgress } from ${JSON.stringify(join(root, 'workers/ai/src/index.ts'))};
export { McpEventHub, McpEventTestReceiver, EventVerification } from ${JSON.stringify(join(root, 'scripts/fixtures/mcp-events.mjs'))};`);
    ai.main = eventsMain;
    ai.vars.MCP_EVENT_CLIENTS = JSON.stringify([
      { principal: 'isolated_primary', tokenSha256: createHash('sha256').update(eventToken).digest('hex') },
      { principal: 'isolated_secondary', tokenSha256: createHash('sha256').update(otherEventToken).digest('hex') },
    ]);
    ai.vars.MCP_EVENT_CALLBACK_HOSTS = callbackHost;
    ai.durable_objects.bindings.push({ name: 'MCP_EVENT_TEST_RECEIVER', class_name: 'McpEventTestReceiver' });
    ai.migrations[0].new_sqlite_classes.push('McpEventTestReceiver');
  }
  const streamGateway = {
    ...api,
    name: 'isolated-stream-gateway',
    services: [{ binding: 'AI_SERVICE', service: 'isolated-ai-fixture' }],
  };
  const aiFixture = {
    name: 'isolated-ai-fixture', main: join(root, 'scripts/fixtures/ai-gateway.mjs'),
    compatibility_date: '2026-09-08', compatibility_flags: ['enable_request_signal'],
    services: [
      { binding: 'PUBLIC_STATUS', service: 'isolated-api', entrypoint: 'PublicStatus' },
      { binding: 'GATEWAY', service: 'isolated-stream-gateway' },
      { binding: 'FIXTURE', service: 'isolated-ai-fixture' },
    ],
  };
  const ingress = {
    name: 'isolated-ingress', main: join(root, 'workers/ingress/src/index.ts'),
    compatibility_date: '2026-09-08', compatibility_flags: ['nodejs_compat', 'nodejs_compat_populate_process_env'],
    vars: { ...access.vars, EMBY_PUBLIC_URL: '' },
    services: [{ binding: 'CORE', service: 'isolated-api', entrypoint: 'StateCore' }],
    r2_buckets: [{ binding: 'IMAGES', bucket_name: 'isolated-images' }],
    kv_namespaces: kv,
  };
  const routerMain = join(temporary, 'router.mjs');
  await writeFile(routerMain, `import router from ${JSON.stringify(join(root, 'workers/dev-router/src/index.ts'))};
export default { fetch(request, env) {
  if (env.VERIFY_EVENTS && new URL(request.url).pathname.startsWith('/__verify/mcp-events/')) return env.VERIFY_EVENTS.fetch(request);
  return new URL(request.url).pathname.startsWith('/__verify/') ? env.VERIFY.fetch(request) : router.fetch(request, env);
} };`);
  const router = {
    name: 'isolated-router', main: routerMain,
    compatibility_date: '2026-09-08',
    services: [
      { binding: 'API', service: 'isolated-api' },
      { binding: 'INGRESS', service: 'isolated-ingress' },
      { binding: 'VERIFY', service: 'isolated-ai-fixture', entrypoint: 'Verification' },
      ...(verifyMcpEvents ? [{ binding: 'VERIFY_EVENTS', service: 'isolated-ai', entrypoint: 'EventVerification' }] : []),
    ],
  };
  const configPaths = [];
  for (const [name, config] of Object.entries({ router, api, ingress, ai, streamGateway, aiFixture })) {
    const path = join(temporary, `${name}.wrangler.json`);
    await writeFile(path, JSON.stringify(config));
    configPaths.push(path);
  }
  const startWorkers = () => start(process.execPath, [require.resolve('wrangler'), 'dev', ...configPaths.flatMap(path => ['-c', path]), '--port', String(workerPort), '--persist-to', join(temporary, 'state')]);
  let workerChild = startWorkers();
  const notices = [];
  const mockSite = httpServer((request, response) => {
    let body = ''; request.on('data', chunk => body += chunk);
    request.on('end', () => { assert.equal(request.headers.authorization, `Bearer ${secret}-revalidate`); notices.push(JSON.parse(body)); response.setHeader('content-type', 'application/json'); response.end('{"ok":true}'); });
  });
  mockSite.listen(sitePort, '127.0.0.1');
  children.push({ kill: () => mockSite.close(), exitCode: 0 });
  await eventually(async () => assert.equal((await fetch(`${worker}/count`, { signal: AbortSignal.timeout(1000) })).status, 200));
  // 路由 Worker 先起来时，后面两个可能还没注册好；等上报入口也答得上话
  await eventually(async () => assert.deepEqual(await (await fetch(`${worker}/api/ingest/mac`)).json(), { ok: false, error: '只接受 POST' }));
  assert.deepEqual(await (await fetch(`${worker}/count`)).json(), { ok: true, connections: 0, online: 0 });
  assert.equal((await otlp()).status, 503, 'OTLP must preserve the storage initialization barrier');
  assert.equal((await post(worker, '/api/ingest/homepod', {})).status, 503);
  assert.equal((await post(worker, '/api/ingest/iphone', { version: 1 })).status, 503);
  assert.equal((await post(worker, '/api/ingest/iphone', {})).status, 503);
  assert.equal((await fetch(`${worker}/api/status/listening/now`)).status, 503);
  assert.equal((await fetch(`${worker}/api/status/not-a-route`)).status, 404);
  assert.equal((await fetch(`${worker}/__verify/public-status?path=${encodeURIComponent('/api/status/listening/now')}`)).status, 503);
  assert.equal((await post(worker, '/api/internal/storage/import', { entries: [], finalize: true }, `${secret}-import`)).status, 200);
  console.log('PASS: known public routes preserve the initialization barrier; unknown routes stay in the Worker');

  const aiHeaders = { Origin: 'https://lyjw.me', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.10' };
  async function mcp(method, params = {}) {
    const response = await fetch(`${worker}/mcp`, {
      method: 'POST', headers: aiHeaders,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('access-control-allow-origin'), aiHeaders.Origin);
    return response.json();
  }
  async function modernMcp(method, params = {}, token, status = 200) {
    const version = '2026-07-28';
    const response = await fetch(`${worker}/mcp`, {
      method: 'POST',
      headers: {
        ...aiHeaders, 'MCP-Protocol-Version': version, 'Mcp-Method': method,
        ...(params.name ? { 'Mcp-Name': params.name } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method, params: {
        ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientCapabilities': {} },
      } }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, status, await response.clone().text());
    assert.equal(response.headers.get('access-control-allow-origin'), aiHeaders.Origin);
    const body = await response.json();
    if (body.result) assert.equal(body.result.resultType, 'complete');
    return body;
  }
  const initialized = await mcp('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'isolated-verification', version: '1' } });
  assert.equal(initialized.result.protocolVersion, '2025-03-26');
  assert.deepEqual(initialized.result.capabilities, { tools: {} });
  const tools = (await mcp('tools/list')).result.tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['get_site_status', 'read_project_doc']);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
  const discovered = (await modernMcp('server/discover')).result;
  assert.deepEqual(discovered.capabilities, { tools: {} });
  assert.equal(discovered.cacheScope, 'private');
  assert.equal(discovered.ttlMs, 0);
  assert.equal((await modernMcp('events/list', {}, undefined, 401)).error.code, -32012);
  assert.equal((await modernMcp('events/list', {}, 'invalid-token-long-enough-for-auth-0000', 401)).error.code, -32012);
  assert.equal((await mcp('events/list')).error.code, -32601);
  if (!verifyMcpEvents) assert.equal((await modernMcp('events/list', {}, eventToken, 401)).error.code, -32012);
  console.log(`PASS: modern discovery hides Events from anonymous clients; invalid-auth and legacy Events requests fail closed${verifyMcpEvents ? '' : '; Events remain disabled without configuration'}`);
  for (const path of ['/api/chat', '/api/github/issue']) {
    const response = await fetch(`${worker}${path}`, { method: 'POST', headers: aiHeaders, body: '{}' });
    assert.equal(response.status, 503, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), aiHeaders.Origin);
    assert.equal(typeof (await response.json()).error, 'string');
    assert.equal((await fetch(`${worker}${path}`, { headers: aiHeaders })).status, 405);
  }
  const usageResponse = await fetch(`${worker}/api/chat/usage`, { headers: aiHeaders });
  assert.equal(usageResponse.status, 200);
  assert.equal(usageResponse.headers.get('access-control-allow-origin'), aiHeaders.Origin);
  const usage = await usageResponse.json();
  assert.equal(usage.visitor.used, 0);
  assert.equal(usage.resetInMs, 0);
  assert.ok(Object.values(usage.tiers).every(tier => tier.visitor.used === 0 && tier.everyone.used === 0));
  assert.equal((await fetch(`${worker}/api/chat/usage`, { method: 'POST', headers: aiHeaders })).status, 405);
  for (const path of ['/mcp', '/api/chat', '/api/chat/usage', '/api/github/issue']) {
    const response = await fetch(`${worker}${path}`, {
      method: path === '/api/chat/usage' ? 'GET' : 'POST', headers: { ...aiHeaders, Origin: 'https://untrusted.invalid' },
    });
    assert.equal(response.status, 403, path);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const preflight = await fetch(`${worker}${path}`, { method: 'OPTIONS', headers: aiHeaders });
    assert.equal(preflight.status, 204, path);
    assert.equal(preflight.headers.get('access-control-allow-origin'), aiHeaders.Origin);
    if (path === '/mcp') assert.match(preflight.headers.get('access-control-allow-headers'), /MCP-Protocol-Version/);
  }
  for (const path of ['/api/internal/storage', '/api/internal/storage/import', '/api/musickit/token', '/api/chat', '/api/status/not-a-route', '/api/status/listening/now?private=1', 'https://lyjw.me/api/status/listening/now']) {
    assert.equal((await fetch(`${worker}/__verify/public-status?path=${encodeURIComponent(path)}`)).status, 404, path);
  }
  const invalidViews = await mcp('tools/call', { name: 'get_site_status', arguments: { views: ['/api/internal/storage', 'not-a-view'] } });
  assert.equal(invalidViews.result.isError, true);
  console.log('PASS: API → AI Service Binding preserves MCP, quota DO reads, offline chat/issue errors and CORS; PublicStatus rejects private and arbitrary paths');

  const upstreamError = await fetch(`${worker}/__verify/chat?mode=error`, { method: 'POST' });
  assert.equal(upstreamError.status, 429);
  assert.equal(upstreamError.headers.get('retry-after'), '17');
  assert.equal(upstreamError.headers.get('cache-control'), 'no-store');
  assert.equal(upstreamError.headers.get('x-ai-fixture'), 'error');
  assert.deepEqual(await upstreamError.json(), { error: 'fixture quota exhausted' });
  const streamHeaders = { Origin: 'https://lyjw.me', 'CF-Connecting-IP': '192.0.2.11', 'MCP-Protocol-Version': '2025-03-26' };
  const streamResponse = await fetch(`${worker}/__verify/chat`, { method: 'POST', headers: streamHeaders, body: 'forwarded request body', signal: AbortSignal.timeout(10_000) });
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get('content-type'), /^application\/x-ndjson/);
  assert.equal(streamResponse.headers.get('cache-control'), 'no-store');
  assert.equal(streamResponse.headers.get('x-observed-origin'), streamHeaders.Origin);
  assert.equal(streamResponse.headers.get('x-observed-client-ip'), streamHeaders['CF-Connecting-IP']);
  assert.equal(streamResponse.headers.get('x-observed-mcp-protocol'), streamHeaders['MCP-Protocol-Version']);
  const reader = streamResponse.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), '{"type":"route","route":"haiku","tier":"haiku"}\n', 'the first NDJSON event must arrive before the delayed text');
  let rest = '';
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    rest += new TextDecoder().decode(next.value);
  }
  assert.deepEqual(JSON.parse(rest), { type: 'text', text: 'forwarded request body' });
  const cancellationId = crypto.randomUUID();
  assert.equal((await fetch(`${worker}/__verify/cancel?direct&id=direct-${cancellationId}`, { signal: AbortSignal.timeout(10_000) })).status, 204);
  assert.equal((await fetch(`${worker}/__verify/cancel?id=${cancellationId}`, { signal: AbortSignal.timeout(10_000) })).status, 204);
  const cancellations = await (await fetch(`${worker}/__verify/cancellations`)).json();
  assert.ok(cancellations.includes(`direct-${cancellationId}`), 'the direct Service Binding must observe request cancellation');
  assert.ok(cancellations.includes(cancellationId), 'request cancellation must cross the API gateway');
  console.log('PASS: the real API gateway forwards NDJSON without buffering, preserves upstream error status/headers/body and propagates request cancellation');

  for (const client of [agentsClient, macClient, 'unregistered.access']) {
    assert.equal((await otlp(emptyMetrics, {}, client)).status, 403, `${client} cannot submit cloud usage`);
  }
  for (const path of ['/api/ingest/agents', '/api/ingest/mac', '/api/internal/site-deployed']) {
    assert.equal((await otlp('{}', {}, cloudClient, path)).status, 403, `cloud token cannot write ${path}`);
  }
  assert.equal((await fetch(`${worker}${otlpPath}`, {
    method: 'POST', headers: { authorization: 'Bearer retired-cloud-secret' }, body: emptyMetrics,
  })).status, 401);
  assert.equal((await fetch(`${worker}${otlpPath}`, {
    method: 'POST', headers: { 'CF-Access-Client-Id': cloudClient, 'CF-Access-Client-Secret': 'unsigned' }, body: emptyMetrics,
  })).status, 401, 'origin trusts only the signed Access assertion');
  assert.equal((await otlp(emptyMetrics, {}, cloudClient, '/api/ingest/agents-otlp')).status, 404);
  assert.equal((await fetch(`${worker}${otlpPath}`, { headers: await access.headers(cloudClient) })).status, 405);
  for (const compressed of [false, true]) {
    const response = await otlp(compressed ? gzipSync(emptyMetrics) : emptyMetrics, compressed ? { 'content-encoding': 'gzip' } : {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {});
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await otlp('{}')).status, 400);
  assert.equal((await otlp('invalid gzip', { 'content-encoding': 'gzip' })).status, 400);
  assert.equal((await otlp(emptyMetrics, { 'content-encoding': 'br' })).status, 415);
  console.log('PASS: OTLP Access permissions are isolated; JSON/gzip responses and failure statuses match the exporter contract');

  const overridePaths = [
    '/api/status/activity', '/api/status/server', '/api/status/workouts',
    '/api/status/watching', '/api/status/watching/now', '/api/status/listening/now',
  ];
  const putOverride = path => fetch(`${worker}/api/dev/override${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marker: path }),
  });
  assert.ok((await Promise.all(overridePaths.map(putOverride))).every(response => response.status === 200));
  let overrideList = await (await fetch(`${worker}/api/dev/overrides`)).json();
  assert.deepEqual([...overrideList.paths].sort(), [...overridePaths].sort());
  assert.ok((await Promise.all(overridePaths.filter((_, index) => index % 2 === 0).map(path =>
    fetch(`${worker}/api/dev/override${path}`, { method: 'DELETE' })
  ))).every(response => response.status === 200));
  overrideList = await (await fetch(`${worker}/api/dev/overrides`)).json();
  assert.deepEqual([...overrideList.paths].sort(), overridePaths.filter((_, index) => index % 2 === 1).sort());
  assert.ok((await Promise.all(overridePaths.map(path =>
    fetch(`${worker}/api/dev/override${path}`, { method: 'DELETE' })
  ))).every(response => response.status === 200));
  console.log('PASS: concurrent local overrides atomically maintain their StateHub index');
  assert.equal((await fetch(`${worker}/online/ws`)).status, 404);
  const events = [];
  const onlineSeen = () => events.filter(e => e.type === 'online').map(e => e.payload.online);
  const audience = async () => (await (await fetch(`${worker}/count`)).json());
  const background = new WebSocket(`${worker.replace('http:', 'ws:')}/ws?visible=0`);
  const backgroundSeen = [];
  background.addEventListener('message', e => { if (e.data !== 'pong') backgroundSeen.push(JSON.parse(e.data)); });
  await once(background, 'open');
  await eventually(async () => assert.deepEqual(backgroundSeen, [{ type: 'online', payload: { online: 0 } }]));
  assert.deepEqual(await audience(), { ok: true, connections: 1, online: 0 });
  socket = new WebSocket(`${worker.replace('http:', 'ws:')}/ws?visible=1`);
  socket.addEventListener('message', e => { if (e.data !== 'pong') events.push(JSON.parse(e.data)); });
  await once(socket, 'open');
  await eventually(async () => assert.deepEqual(onlineSeen(), [1]));
  await eventually(async () => assert.ok(backgroundSeen.some(e => e.payload.online === 1), 'visible arrivals are broadcast to everyone'));
  assert.deepEqual(await audience(), { ok: true, connections: 2, online: 1 });
  socket.send('hidden');
  await eventually(async () => assert.deepEqual(onlineSeen(), [1, 0]));
  assert.deepEqual(await audience(), { ok: true, connections: 2, online: 0 });
  socket.send('hidden');
  socket.send('visible');
  await eventually(async () => assert.deepEqual(onlineSeen(), [1, 0, 1]));
  background.send('visible');
  await eventually(async () => assert.deepEqual(onlineSeen(), [1, 0, 1, 2]));
  background.close();
  await eventually(async () => assert.deepEqual(onlineSeen(), [1, 0, 1, 2, 1]));
  assert.deepEqual(await audience(), { ok: true, connections: 1, online: 1 });
  console.log('PASS: one push socket carries both counts; visibility handshake, visible/hidden messages and close all rebroadcast online');
  async function post(base, path, body, token) {
    const auth = token === undefined ? await access.headers() : { authorization: `Bearer ${token}` };
    return fetch(`${base}${path}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  }
  assert.equal((await post(worker, '/publish', { type: 'presence', payload: null })).status, 404);
  assert.equal((await post(worker, '/api/ingest/homepod', {}, 'wrong')).status, 401);
  assert.equal((await post(worker, '/api/ingest/constructor', {})).status, 404);
  const questAt = Date.now();
  const questReport = (at, playing) => ({ version: 1, presence: { observedAt: at, discordStatus: 'online', playing } });
  const questGame = { name: 'Isolated Quest game', platform: 'meta_quest', applicationId: '123' };
  const sendQuest = body => fetch(`${worker}/api/ingest/quest`, {
    method: 'POST', headers: { ...questHeaders, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const questHeaders = await access.headers(questClient);
  assert.equal((await fetch(`${worker}/api/ingest/quest`, {
    method: 'POST', headers: { ...await access.headers(macClient), 'content-type': 'application/json' }, body: JSON.stringify(questReport(questAt, questGame)),
  })).status, 403);
  const questReceipt = await sendQuest(questReport(questAt, questGame));
  assert.equal(questReceipt.status, 202);
  assert.equal((await questReceipt.json()).data.changed, true);
  await eventually(async () => assert.equal(events.filter(e => e.type === 'quest-now').length, 1));
  const heartbeatReceipt = await sendQuest(questReport(questAt + 1000, questGame));
  assert.equal((await heartbeatReceipt.json()).data.changed, false);
  const oldReceipt = await sendQuest(questReport(questAt, null));
  assert.equal((await oldReceipt.json()).data.changed, false);
  const questState = (await (await fetch(`${worker}/api/status/quest/now`)).json()).data;
  assert.equal(questState.available, true);
  assert.equal(questState.playing.name, questGame.name);
  assert.equal(questState.observedAt, questAt + 1000);
  assert.equal((await sendQuest(questReport(questAt + 2000, { ...questGame, platform: 'ps5' }))).status, 400);
  assert.equal((await sendQuest(questReport(questAt + 2000, null))).status, 202);
  await eventually(async () => assert.equal(events.filter(e => e.type === 'quest-now').length, 2));
  assert.equal((await (await fetch(`${worker}/api/status/quest/now`)).json()).data.playing, null);
  for (const path of ['/api/ingest/mac', '/api/ingest/agents']) {
    assert.equal((await fetch(`${worker}${path}`, { method: 'POST', headers: { ...questHeaders, 'content-type': 'application/json' }, body: '{}' })).status, 403);
  }
  console.log('PASS: Quest dedicated Access permission → DO state → current endpoint and change-only WebSocket events; heartbeats and old reports do not broadcast');
  const invalidEnvelope = await post(worker, '/api/ingest/mac', {});
  assert.equal(invalidEnvelope.status, 400);
  assert.deepEqual(await invalidEnvelope.json(), { ok: false, error: '上报数据无效或处理失败' });
  const invalidJson = await fetch(`${worker}/api/ingest/mac`, {
    method: 'POST', headers: await access.headers(),
    body: '{"private-marker":',
  });
  assert.equal(invalidJson.status, 400);
  assert.deepEqual(await invalidJson.json(), { ok: false, error: '上报数据无效或处理失败' });
  assert.equal(invalidJson.headers.get('cache-control'), 'no-store');
  async function nowPlaying() {
    return (await (await fetch(`${worker}/api/status/listening/now`)).json()).data?.music?.title;
  }
  for (const title of ['isolated-first', 'isolated-second']) {
    const body = { entityId: 'media_player.isolated', state: 'playing', title, positionMs: 0, durationMs: 3600000, observedAt: Date.now() };
    assert.equal((await post(worker, '/api/ingest/homepod', body)).status, 202);
    await eventually(async () => assert.equal(await nowPlaying(), title));
    await eventually(async () => assert.ok(events.some(e => e.type === 'listening-now' && e.payload.music?.title === title)));
  }
  const statusTool = await mcp('tools/call', { name: 'get_site_status', arguments: { views: ['nowListening'] } });
  assert.equal(statusTool.result.isError, false);
  const statusText = statusTool.result.content[0].text;
  assert.equal(JSON.parse(statusText.split('## nowListening\n')[1]).data.music.title, 'isolated-second');
  assert.equal(/musicUserToken|developerToken/.test(statusText), false);
  console.log('PASS: MCP → AI → PublicStatus RPC reads the latest ingest from StateHub using the public status model');
  await eventually(async () => assert.ok(notices.some(n => n.tags?.includes('listening-now'))));
  const deployed = await post(worker, '/api/internal/site-deployed', {});
  assert.equal(deployed.status, 200);
  assert.deepEqual(await deployed.json(), { ok: true, delivered: 1 });
  await eventually(async () => assert.ok(events.some(e => e.type === 'version' && e.payload === null)));
  assert.equal((await fetch(`${worker}/api/internal/site-deployed`, { headers: await access.headers() })).status, 405);
  await sleep(200);
  const homePodNotices = notices.length;
  await post(worker, '/api/ingest/homepod', { entityId: 'media_player.isolated', state: 'playing', title: 'isolated-second', positionMs: 2000, durationMs: 3600000, observedAt: Date.now() });
  await sleep(200);
  assert.equal(notices.length, homePodNotices, 'HomePod position heartbeat must not invalidate page');
  console.log('PASS: ingress → StateCore.commitIngest → Durable Object SQLite → /api/revalidate → direct Worker status; WebSocket receives both updates and the site-deployed version event');
  const beforeTimezone = notices.length;
  const response = await post(worker, '/api/ingest/mac', { version: 4, heartbeatAt: Date.now(), presence: 'online', activeModules: ['timezone'], modules: { timezone: { identifier: 'Asia/Singapore', secondsFromGMT: 28800 } } });
  assert.equal(response.status, 202);
  await sleep(300);
  assert.equal(notices.slice(beforeTimezone).some(n => n.tags?.includes('timezone')), false, 'Timezone content change must not invalidate page');
  const before = notices.length;
  assert.equal((await post(worker, '/api/ingest/mac', { version: 4, heartbeatAt: Date.now(), presence: 'online', activeModules: ['timezone'], modules: {} })).status, 202);
  await sleep(300);
  assert.equal(notices.length, before, 'Pure heartbeat must not invalidate page');
  const timezone = await (await fetch(`${worker}/api/status/timezone`)).json();
  assert.equal(timezone.ok, true);
  assert.equal((await fetch(`${worker}/api/home`)).status, 404, 'The aggregate endpoint is gone; the first screen reads per card');
  assert.equal((await fetch(`${worker}/api/internal/storage`)).status, 404);
  assert.equal((await post(worker, '/api/internal/storage', { commands: [] })).status, 405);
  assert.equal((await fetch(`${worker}/api/status/listening/now`, { headers: { Origin: 'http://localhost:3000' } })).headers.get('access-control-allow-origin'), 'http://localhost:3000');
  const publicBodies = await Promise.all(['/api/status/listening/now', '/api/status/listening', '/api/status/desktop', '/api/status/timezone']
    .map(async (path) => (await fetch(`${worker}${path}`)).text()));
  assert.equal(publicBodies.some((body) => body.includes('musicUserToken') || body.includes('developerToken')), false);
  console.log('PASS: per-card endpoints, CORS, private storage removed, heartbeat does not invalidate HTML');
  const embyMedia = {
    container: 'mkv', bitrate: 6421965,
    video: { codec: 'hevc', width: 3840, height: 1600, range: 'hdr10', bitDepth: 10 },
    audio: { codec: 'dts', profile: 'DTS-HD MA', channels: 8, layout: '7.1', language: 'jpn' },
    subtitle: { codec: 'srt', language: 'zh-CN', title: null, forced: false, external: true, path: '\\\\nas\\private.srt' },
  };
  const embyReport = await post(worker, '/api/ingest/emby', { playing: {
    itemId: 'isolated-episode', paused: false, positionTicks: 600_000_000, runTimeTicks: 14_400_000_000,
    client: 'Infuse-Direct', deviceName: 'iPad', playMethod: 'directplay', media: embyMedia,
    item: { id: 'isolated-episode', name: 'Pilot', type: 'Episode', serverId: null, seriesName: 'Isolated Show', season: 1, episode: 1, year: 2026, progress: 4.2, playedAt: null, posterKey: null, backdropKey: null },
  } });
  assert.equal(embyReport.status, 202, await embyReport.text());
  const expectedMedia = { ...embyMedia, subtitle: { codec: 'srt', language: 'zh-CN', title: null, forced: false, external: true } };
  await eventually(async () => {
    const now = (await (await fetch(`${worker}/api/status/watching/now`)).json()).data;
    assert.equal(now.nowPlaying?.client, 'Infuse-Direct');
    assert.equal(now.nowPlaying?.deviceName, 'iPad');
    assert.equal(now.nowPlaying?.playMethod, 'directplay');
    assert.deepEqual(now.nowPlaying?.media, expectedMedia);
    assert.equal(now.current?.title, 'Isolated Show');
  });
  await eventually(async () => assert.ok(events.some(e => e.type === 'watching-now' && e.payload.nowPlaying?.media?.audio?.profile === 'DTS-HD MA')));
  assert.equal(JSON.stringify(events).includes('private.srt'), false);
  const embyJunk = await post(worker, '/api/ingest/emby', { playing: {
    itemId: 'isolated-episode', paused: true, positionTicks: 700_000_000, runTimeTicks: 14_400_000_000,
    client: 'x'.repeat(200), deviceName: null, playMethod: 'Transcode', media: { video: { codec: 'hevc', range: 'HDR10', width: -1 } },
  } });
  assert.equal(embyJunk.status, 202);
  await eventually(async () => {
    const now = (await (await fetch(`${worker}/api/status/watching/now`)).json()).data;
    assert.equal(now.nowPlaying?.paused, true);
    assert.equal(now.nowPlaying?.client?.length, 64);
    assert.equal(now.nowPlaying?.playMethod, null, 'play method is case-sensitive lowercase');
    assert.deepEqual(now.nowPlaying?.media, { container: null, bitrate: null, video: { codec: 'hevc', width: null, height: null, range: null, bitDepth: null }, audio: null, subtitle: null });
  });
  assert.equal((await post(worker, '/api/ingest/emby', { playing: null })).status, 202);
  await eventually(async () => assert.equal((await (await fetch(`${worker}/api/status/watching/now`)).json()).data.nowPlaying, null));
  console.log('PASS: Emby playback carries device, play method and media spec; junk fields are dropped');
  const tokenResponse = await fetch(`${worker}/api/musickit/token`, { headers: { Origin: 'http://localhost:3000' } });
  const tokenBody = await tokenResponse.text();
  assert.equal(tokenResponse.status, 200, tokenBody);
  assert.equal(tokenResponse.headers.get('cache-control'), 'no-store');
  assert.equal(tokenResponse.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  const issued = JSON.parse(tokenBody);
  assert.ok(Number.isSafeInteger(issued.issuedAt) && issued.expiresAt === issued.issuedAt + 7 * 24 * 3600);
  const [tokenHeader, tokenPayload, tokenSignature] = issued.token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(tokenHeader, 'base64url')), { alg: 'ES256', kid: 'ISOLATEDKY' });
  assert.deepEqual(JSON.parse(Buffer.from(tokenPayload, 'base64url')), { iss: 'ISOLATEDTM', iat: issued.issuedAt, exp: issued.expiresAt });
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, musicKitKeys.publicKey, Buffer.from(tokenSignature, 'base64url'), Buffer.from(`${tokenHeader}.${tokenPayload}`)));
  assert.equal((await post(worker, '/api/musickit/token', {})).status, 405);
  console.log('PASS: /api/musickit/token issues a verifiable ES256 developer token');
  const coding = start(process.execPath, [join(root, 'scripts/verify-coding-usage.mjs'), '--base', worker, '--ingest', worker, '--storage-prefix', 'isolated-verify'], { LOCAL_ACCESS_PRIVATE_JWK: JSON.stringify(access.privateJwk) });
  coding.stdout.pipe(process.stdout, { end: false });
  const [codingExit] = await once(coding, 'exit');
  assert.equal(codingExit, 0, logs.join(''));
  console.log('PASS: coding usage, limits, history and invalid-envelope regression');
  const concurrent = Array.from({ length: 8 }, (_, i) => post(worker, '/api/ingest/mac', {
    version: 4, heartbeatAt: Date.now(), presence: 'online', activeModules: ['timezone'],
    modules: i % 2 ? {} : { timezone: { identifier: 'Asia/Singapore', secondsFromGMT: 28800 } },
  }));
  assert.ok((await Promise.all(concurrent)).every(response => response.status === 202));
  assert.equal((await (await fetch(`${worker}/api/status/timezone`)).json()).ok, true);
  console.log('PASS: concurrent heartbeats preserve a separately updated module');
  socket.close();
  const exited = once(workerChild, 'exit');
  workerChild.kill('SIGTERM');
  await exited;
  workerChild = startWorkers();
  await eventually(async () => assert.equal(await nowPlaying(), 'isolated-second'));
  assert.equal((await (await fetch(`${worker}/api/status/timezone`)).json()).ok, true);
  console.log('PASS: restart preserves initialized state and snapshots');
  if (verifyMcpEvents) {
    const callback = path => `https://${callbackHost}${path}`;
    const parameters = (path, extra = {}) => ({ name: 'watching-now', delivery: { mode: 'webhook', url: callback(path), secret: eventSecret }, ...extra });
    async function fixture(operation, body) {
      const response = await fetch(`${worker}/__verify/mcp-events/${operation}`, body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    }
    const advance = milliseconds => fixture('advance', { milliseconds });
    const records = () => fixture('records');
    const deliveries = async path => (await records()).filter(record => new URL(record.url).pathname === path && JSON.parse(record.body).type !== 'verification');
    async function subscribe(params, token = eventToken) {
      const reply = await modernMcp('events/subscribe', params, token);
      assert.equal(reply.error, undefined, JSON.stringify(reply));
      assert.equal(reply.result.cursor, null);
      assert.equal(reply.result.truncated, false);
      assert.ok(Number.isFinite(Date.parse(reply.result.refreshBefore)));
      return reply.result;
    }
    async function unsubscribe(params, token = eventToken) {
      const reply = await modernMcp('events/unsubscribe', {
        name: params.name, ...(params.arguments ? { arguments: params.arguments } : {}),
        delivery: { mode: 'webhook', url: params.delivery.url },
      }, token);
      assert.equal(reply.error, undefined, JSON.stringify(reply));
    }
    function verifySignature(record, secret) {
      const id = record.headers['webhook-id'];
      const timestamp = record.headers['webhook-timestamp'];
      assert.ok(id);
      assert.match(timestamp, /^\d+$/);
      const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${record.body}`).digest('base64');
      assert.ok(record.headers['webhook-signature'].split(' ').includes(`v1,${expected}`));
      assert.match(record.headers['x-mcp-subscription-id'], /^sub_/);
    }
    const authenticated = (await modernMcp('server/discover', {}, eventToken)).result;
    assert.deepEqual(authenticated.capabilities, { tools: {}, events: {} });
    const catalog = (await modernMcp('events/list', {}, eventToken)).result;
    assert.deepEqual(catalog.events.map(event => event.name), ['watching-now']);
    assert.deepEqual(catalog.events[0].delivery, ['webhook']);
    assert.equal(catalog.cacheScope, 'private');
    assert.equal((await modernMcp('events/list', { cursor: 'unknown' }, eventToken)).error.code, -32602);
    for (const url of ['http://mcp-events.example.com/hook', 'https://127.0.0.1/hook', 'https://unlisted.example.com/hook']) {
      const rejected = await modernMcp('events/subscribe', { ...parameters('/events'), delivery: { mode: 'webhook', url, secret: eventSecret } }, eventToken);
      assert.equal(rejected.error.code, -32602, url);
    }
    assert.equal((await records()).length, 0, 'invalid callbacks must not reach the receiver');
    assert.equal((await modernMcp('events/subscribe', parameters('/events', { cursor: 'unsupported' }), eventToken)).error.code, -32014);
    await fixture('configure', { path: '/challenge-failure', badChallenge: true });
    assert.equal((await modernMcp('events/subscribe', parameters('/challenge-failure'), eventToken)).error.code, -32015);
    await fixture('configure', { path: '/events', statuses: [503, 204] });
    const original = await subscribe(parameters('/events'));
    assert.equal((await subscribe(parameters('/events'))).id, original.id);
    const secondary = await subscribe(parameters('/events'), otherEventToken);
    assert.notEqual(secondary.id, original.id);
    await unsubscribe(parameters('/events'), otherEventToken);
    await unsubscribe(parameters('/events'), otherEventToken);
    await subscribe(parameters('/paused', { arguments: { change: 'paused' } }));
    await subscribe(parameters('/expired', { ttlMs: 1000 }));
    await advance(0);
    assert.equal((await deliveries('/events')).length, 0, 'subscription baseline must not replay current state');
    const playing = {
      itemId: 'mcp-event-episode', paused: false, positionTicks: 1, runTimeTicks: 14_400_000_000,
      deviceName: 'private-device-marker', client: 'private-client-marker',
      item: { id: 'mcp-event-episode', name: 'MCP Event Episode', type: 'Movie', year: 2026 },
    };
    assert.equal((await post(worker, '/api/ingest/emby', { playing })).status, 202);
    await advance(60_001);
    const first = (await deliveries('/events'))[0];
    assert.ok(first, 'StateCore playback must reach the Events outbox through PublicStatus');
    assert.equal(first.status, 503);
    const firstBody = JSON.parse(first.body);
    assert.equal(firstBody.name, 'watching-now');
    assert.equal(firstBody.data.change, 'started');
    assert.equal(firstBody.data.itemId, playing.itemId);
    assert.equal(firstBody.eventId, first.headers['webhook-id']);
    assert.equal(firstBody.cursor, null);
    assert.equal(first.body.includes('private-'), false);
    verifySignature(first, eventSecret);
    assert.equal((await deliveries('/paused')).length, 0);
    assert.equal((await deliveries('/expired')).length, 0);
    const stopped = once(workerChild, 'exit');
    workerChild.kill('SIGTERM');
    await stopped;
    workerChild = startWorkers();
    await eventually(async () => assert.equal((await (await fetch(`${worker}/api/status/watching/now`)).json()).data.nowPlaying.itemId, playing.itemId));
    await advance(15_001);
    const attempts = await deliveries('/events');
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].body, first.body);
    assert.equal(attempts[1].headers['webhook-id'], first.headers['webhook-id']);
    assert.notEqual(attempts[1].headers['webhook-timestamp'], first.headers['webhook-timestamp']);
    verifySignature(attempts[1], eventSecret);
    assert.equal((await post(worker, '/api/ingest/emby', { playing: { ...playing, positionTicks: 900_000_000 } })).status, 202);
    await advance(60_001);
    assert.equal((await deliveries('/events')).length, 2, 'progress updates must not wake subscribers');
    const rotated = await subscribe({ ...parameters('/events'), delivery: { mode: 'webhook', url: callback('/events'), secret: rotatedEventSecret } });
    assert.equal(rotated.id, original.id);
    assert.ok(Date.parse(rotated.refreshBefore) > Date.parse(original.refreshBefore));
    assert.equal((await post(worker, '/api/ingest/emby', { playing: { ...playing, paused: true } })).status, 202);
    await advance(60_001);
    const paused = (await deliveries('/events')).at(-1);
    assert.equal(JSON.parse(paused.body).data.change, 'paused');
    assert.ok(JSON.parse(paused.body).data.sequence > firstBody.data.sequence);
    verifySignature(paused, rotatedEventSecret);
    verifySignature(paused, eventSecret);
    assert.equal((await deliveries('/paused')).length, 1);
    assert.equal((await deliveries('/expired')).length, 0, 'expired subscription must remain inactive after restart');
    assert.equal((await deliveries('/challenge-failure')).length, 0, 'failed verification must never activate a subscription');
    for (const record of await records()) {
      if (JSON.parse(record.body).type === 'verification') {
        const key = record.headers['webhook-signature'].includes(`v1,${createHmac('sha256', Buffer.from(rotatedEventSecret.slice(6), 'base64')).update(`${record.headers['webhook-id']}.${record.headers['webhook-timestamp']}.${record.body}`).digest('base64')}`)
          ? rotatedEventSecret : eventSecret;
        verifySignature(record, key);
      }
    }
    await unsubscribe(parameters('/events'));
    await unsubscribe(parameters('/events'));
    await unsubscribe(parameters('/paused', { arguments: { change: 'paused' } }));
    const deliveredCount = (await records()).length;
    assert.equal((await post(worker, '/api/ingest/emby', { playing: null })).status, 202);
    await advance(60_001);
    assert.equal((await records()).length, deliveredCount, 'cancellation must stop deliveries');
    console.log('PASS: raw modern Events discovery, signed challenge, principal isolation, StateCore → PublicStatus → durable outbox → webhook, restart/retry deduplication, progress suppression, filtering, rotation, renewal, expiry and cancellation');
  }
  if (verifyMcpClient) {
    async function inspect(era, method, args = []) {
      const output = [];
      const inspector = start('npx', [
        '--yes', '@modelcontextprotocol/inspector@2.10.1', '--cli', `${worker}/mcp`,
        '--transport', 'http', '--protocol-era', era, '--method', method,
        '--format', 'json', '--quiet', '--stored-auth-only', ...args,
      ], {
        MCP_STORAGE_DIR: temporary,
        MCP_INSPECTOR_OAUTH_STATE_PATH: join(temporary, 'inspector-oauth.json'),
        MCP_INSPECTOR_SECRET_STORE: 'memory',
      });
      inspector.stdout.on('data', data => output.push(data.toString()));
      const logStart = logs.length;
      const [code] = await once(inspector, 'exit');
      await writeFile(join(temporary, `inspector-${era}-${method.replace('/', '-')}.log`), logs.slice(logStart).join(''));
      assert.equal(code, 0, `Inspector ${era} ${method}: ${logs.slice(logStart).join('')}`);
      return JSON.parse(output.join('')).result;
    }
    for (const era of ['modern', 'legacy']) {
      const initialized = await inspect(era, 'initialize');
      assert.equal(initialized.serverInfo.name, 'lyjwpage');
      assert.deepEqual(initialized.capabilities, { tools: {} });
      if (era === 'modern') assert.equal(initialized.protocolVersion, '2026-07-28');
      const listed = await inspect(era, 'tools/list', ['--strict']);
      assert.ok(listed.tools.some(tool => tool.name === 'get_site_status'));
      const called = await inspect(era, 'tools/call', ['--tool-name', 'get_site_status', '--tool-arg', 'views=["timezone"]']);
      assert.equal(called.isError, false);
      assert.match(called.content[0].text, /Asia\/Singapore/);
      console.log(`PASS: MCP Inspector ${era} negotiation (${initialized.protocolVersion}), strict tools/list and get_site_status(timezone)`);
    }
  }
  if (verifyBuild) {
    const logStart = logs.length;
    const build = start('pnpm', ['build'], {
      NEXT_PUBLIC_BACKEND_URL: worker,
      SENTRY_AUTH_TOKEN: '',
    });
    const [buildExit] = await once(build, 'exit');
    await writeFile(join(temporary, 'next-build.log'), logs.slice(logStart).join(''));
    assert.equal(buildExit, 0, logs.join('').slice(-12000));
    console.log('PASS: Next production build completes against the initialized isolated Worker');
  }
  const logLines = stripVTControlCharacters(logs.join('')).split('\n');
  assert.equal(logLines.some(line => /Cannot perform I\/O|\[storage\]|Uncaught/.test(line)
    || /\[(?:ERROR|WARNING)\].*\[revalidate\]/.test(line)), false, logs.join(''));
} catch (error) {
  console.error(logs.join('').slice(-12000));
  throw error;
} finally {
  socket?.close();
  for (const child of children.reverse()) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exitCode === null ? Promise.race([once(child, 'exit'), sleep(3000).then(() => child.kill('SIGKILL'))]) : undefined));
  await rm(temporary, { recursive: true, force: true });
}
