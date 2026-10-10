#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, createHmac, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import '../src/lib/testing/register-alias.mjs';

const { BUILD_DESIGN_LIMITS, BUILD_QUOTA, BUILD_STATUS_TTL_MS, BUILD_TIMEOUT_MS, branchForRun } = await import('../shared/build-routine.ts');

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'workers/ai/package.json'));
const temporary = await mkdtemp(join(tmpdir(), 'lyjw-build-verify-'));
const children = [];
const logs = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const baseSha = 'a'.repeat(40);
const headSha = 'e'.repeat(40);
const fixtureSecret = 'local-build-fixture-only';
const plan = { title: 'Improve the fixture card', spec: 'Render the fixture card clearly.', acceptance: ['Readable on a phone'], paths: ['src/components/fixture.tsx'] };

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
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

function storedRun(runId, account = 'visitor', createdAt = Date.now()) {
  return { state: { runId, branch: branchForRun(runId), phase: 'triggered', createdAt, updatedAt: createdAt }, plan, account, accountId: Number(account.replace(/\D/g, '')) || 1, coauthor: 'Fixture <1+fixture@users.noreply.github.com>', baseSha, uploadHash: createHash('sha256').update('fixture-upload').digest('base64url'), uploadUsed: false, uploadExpiresAt: Date.now() + BUILD_TIMEOUT_MS };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(3000).then(() => child.kill('SIGKILL'))]);
}

try {
  const port = await availablePort();
  const worker = `http://127.0.0.1:${port}`;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const configPath = join(temporary, 'wrangler.json');
  // Outside the checkout, Wrangler cannot load the project's real .dev.vars or production bindings.
  await writeFile(configPath, JSON.stringify({
    name: 'isolated-build-verification', main: join(root, 'scripts/fixtures/build-worker.mjs'),
    compatibility_date: '2026-10-09', compatibility_flags: ['nodejs_compat', 'enable_request_signal'],
    vars: {
      BUILD_SESSION_SECRET: fixtureSecret, GITHUB_WEBHOOK_SECRET: fixtureSecret, ROUTINE_FIRE_TOKEN: fixtureSecret,
      ROUTINE_FIRE_URL: 'https://fixture.invalid/fire', GITHUB_APP_CLIENT_SECRET: fixtureSecret,
      GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      FIXTURE_PUBLIC_JWK: JSON.stringify(publicKey.export({ format: 'jwk' })),
    },
    durable_objects: { bindings: [{ name: 'BUILD_COORDINATOR', class_name: 'BuildCoordinator' }, { name: 'BUILD_FIXTURE', class_name: 'BuildFixture' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['BuildCoordinator', 'BuildFixture'] }],
  }));
  const start = () => {
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SystemRoot', 'MINIFLARE_WORKERD_PATH'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    const child = spawn(process.execPath, [require.resolve('wrangler'), 'dev', '-c', configPath, '--port', String(port), '--ip', '127.0.0.1', '--inspector-port', '0', '--persist-to', join(temporary, 'state')], {
      cwd: temporary, env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(temporary, 'wrangler.log') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => logs.push(chunk.toString()));
    return child;
  };
  let child = start();
  const ready = () => eventually(async () => assert.equal((await fetch(`${worker}/__fixture/ready`, { signal: AbortSignal.timeout(1000) })).status, 200));
  await ready();
  async function post(path, body, headers = {}) {
    return fetch(`${worker}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  }
  async function rpc(name, method, ...args) {
    const response = await post('/__fixture/rpc', { name, method, args });
    assert.equal(response.status, 200, `RPC ${method} responds successfully`);
    return response.json();
  }
  async function inspect() { return (await fetch(`${worker}/__fixture/inspect`)).json(); }
  const expiresAt = Date.now() + 60_000;

  const planClaims = await Promise.all(Array.from({ length: 16 }, () => rpc('plan-race', 'claimPlan', 'same-plan', expiresAt)));
  assert.equal(planClaims.filter(Boolean).length, 1);
  assert.equal(await rpc('plan-race', 'claimPlan', 'expired-plan', Date.now() - 1), false);
  const exits = await Promise.all([
    rpc('plan-exits', 'claimPlan', 'shared-destination-plan', expiresAt),
    rpc('plan-exits', 'reserveRun', storedRun('4'.repeat(32)), 'shared-destination-plan', expiresAt),
  ]);
  assert.equal(exits.filter((result) => result === true || result === 'ok').length, 1);
  const uploadRun = storedRun('1'.repeat(32));
  assert.equal(await rpc('upload-race', 'reserveRun', uploadRun, 'upload-plan', expiresAt), 'ok');
  const uploads = await Promise.all(Array.from({ length: 16 }, () => rpc('upload-race', 'claimUpload', uploadRun.state.runId, uploadRun.uploadHash)));
  assert.equal(uploads.filter(Boolean).length, 1);
  assert.equal((await rpc('upload-race', 'readRun', uploadRun.state.runId)).state.phase, 'uploaded');
  console.log('PASS: real Durable Object RPC and SQLite transactions consume concurrent plan/upload claims once');

  const designIds = Array.from({ length: BUILD_DESIGN_LIMITS.everyone + 5 }, (_, index) => `design-${index}`);
  const designResults = await Promise.all(designIds.map((id) => rpc('design-quota', 'createDesign', id, Date.now() + BUILD_DESIGN_LIMITS.ttlMs - 1000)));
  assert.equal(designResults.filter(Boolean).length, BUILD_DESIGN_LIMITS.everyone);
  const designId = designIds[designResults.findIndex(Boolean)];
  const turns = await Promise.all(Array.from({ length: BUILD_DESIGN_LIMITS.maxTurns + 5 }, () => rpc('design-quota', 'admitDesign', designId)));
  assert.equal(turns.filter((result) => result.status === 'ok').length, BUILD_DESIGN_LIMITS.maxTurns);
  assert.equal(turns.filter((result) => result.status === 'exhausted').length, 5);
  assert.equal((await rpc('design-quota', 'admitDesign', 'missing')).status, 'expired');
  console.log('PASS: concurrent planning admission enforces 20 sessions per hour and 12 turns per session');

  const accountRuns = await Promise.all(Array.from({ length: 8 }, (_, index) => rpc('account-quota', 'reserveRun', storedRun((100 + index).toString(16).padStart(32, '0'), `same-account-${index ? 'renamed' : 'initial'}`), `account-plan-${index}`, expiresAt)));
  assert.equal(accountRuns.filter((result) => result === 'ok').length, BUILD_QUOTA.fire.account);
  assert.equal(accountRuns.filter((result) => result === 'account').length, 5);
  const siteRuns = await Promise.all(Array.from({ length: 15 }, (_, index) => rpc('site-quota', 'reserveRun', storedRun((200 + index).toString(16).padStart(32, '0'), `visitor-${index + 1}`), `site-plan-${index}`, expiresAt)));
  assert.equal(siteRuns.filter((result) => result === 'ok').length, BUILD_QUOTA.fire.everyone);
  assert.equal(siteRuns.filter((result) => result === 'site').length, 5);
  console.log('PASS: persisted build quotas enforce 3 per GitHub account and 10 site-wide without races');

  const timedRun = storedRun('2'.repeat(32), 'visitor-2', Date.now() - BUILD_TIMEOUT_MS - 1000);
  assert.equal(await rpc('timeout', 'reserveRun', timedRun, 'timeout-plan', expiresAt), 'ok');
  assert.equal((await rpc('timeout', 'readRun', timedRun.state.runId)).state.phase, 'timeout');
  assert.equal(await rpc('timeout', 'claimUpload', timedRun.state.runId, timedRun.uploadHash), null);
  const stalledUpload = { ...storedRun('5'.repeat(32), 'visitor-3'), uploadUsed: true };
  stalledUpload.state.phase = 'uploaded';
  stalledUpload.state.updatedAt = Date.now() - BUILD_TIMEOUT_MS - 1000;
  assert.equal(await rpc('timeout', 'reserveRun', stalledUpload, 'stalled-upload-plan', expiresAt), 'ok');
  assert.equal((await rpc('timeout', 'readRun', stalledUpload.state.runId)).state.phase, 'timeout');
  console.log('PASS: stalled dispatches and uploads report unknown-result timeouts without accepting replays');

  const signIn = { code: 'fixture-code', codeVerifier: 'x'.repeat(43) };
  const proposalResponse = await post('/__fixture/plan', plan);
  assert.equal(proposalResponse.status, 200);
  const proposal = await proposalResponse.json();
  await post('/__fixture/configure', { mainUnavailable: true });
  for (let n = 0; n <= BUILD_QUOTA.fire.account; n += 1) {
    assert.equal((await post('/api/build', { ...signIn, planToken: proposal.token })).status, 502);
  }
  assert.equal((await inspect()).fires.length, 0);
  await post('/__fixture/configure', { mainUnavailable: false });
  const fires = await Promise.all(Array.from({ length: 8 }, () => post('/api/build', { ...signIn, planToken: proposal.token })));
  assert.equal(fires.filter((response) => response.status === 202).length, 1);
  assert.equal(fires.filter((response) => response.status === 409).length, 7);
  const build = await fires.find((response) => response.status === 202).json();
  const fixture = await inspect();
  assert.equal(fixture.fires.length, 1);
  const installationCalls = fixture.calls.filter((call) => call.path.endsWith('/access_tokens'));
  assert.ok(installationCalls.length > BUILD_QUOTA.fire.account);
  assert.ok(installationCalls.every((call) => Object.values(call.body.permissions).every((permission) => permission === 'read')));
  console.log('PASS: main uses a read-only App installation token and repeated read failures do not consume the plan or build quota');
  const fired = fixture.fires[0];
  assert.equal(fired.runId, build.runId);
  assert.equal(fired.baseSha, baseSha);
  assert.match(fired.coauthor, /131\+fixture-visitor@users\.noreply\.github\.com/);
  const exchanges = fixture.calls.filter((call) => call.path.includes('/login/oauth/access_token')).length;
  assert.ok(exchanges > BUILD_QUOTA.fire.account);
  assert.equal(fixture.calls.filter((call) => call.method === 'DELETE' && call.path.includes('/applications/')).length, exchanges);
  const progress = await post(`/api/build/progress?runId=${build.runId}`, { message: 'Fixture implementation underway.' }, { Authorization: `Bearer ${fired.uploadToken}` });
  assert.equal(progress.status, 200);
  const getStatus = () => fetch(`${worker}/api/build/status?runId=${build.runId}`, { headers: { Authorization: `Bearer ${build.statusToken}` } });
  assert.equal((await (await getStatus()).json()).phase, 'running');
  const upload = { baseSha, message: 'feat: improve fixture card', files: [{ path: 'src/components/fixture.tsx', content: Buffer.from('export const fixture = true;\n').toString('base64'), mode: '100644' }], deletions: [] };
  const uploaded = await Promise.all(Array.from({ length: 8 }, () => post(`/api/build/upload?runId=${build.runId}`, upload, { Authorization: `Bearer ${fired.uploadToken}` })));
  assert.equal(uploaded.filter((response) => response.status === 201).length, 1);
  assert.equal(uploaded.filter((response) => response.status === 401).length, 7);
  assert.equal((await post(`/api/build/progress?runId=${build.runId}`, { message: 'Too late' }, { Authorization: `Bearer ${fired.uploadToken}` })).status, 401);
  const afterUpload = await inspect();
  assert.equal(afterUpload.jwtVerified, true);
  const writes = afterUpload.calls.filter((call) => call.method === 'POST' && call.path.startsWith('api.github.com/repos/'));
  assert.equal(writes.length, 5);
  assert.equal(writes.find((call) => call.path.endsWith('/git/refs')).body.ref, `refs/heads/${build.branch}`);
  assert.equal(writes.find((call) => call.path.endsWith('/pulls')).body.draft, false);
  assert.match(writes.find((call) => call.path.endsWith('/git/commits')).body.message, /Co-authored-by: Fixture Visitor/);
  const status = await (await getStatus()).json();
  assert.equal(status.phase, 'pr_open');
  assert.equal(status.pr.number, 101);
  assert.equal(status.ci.state, 'success');
  assert.equal(status.preview.state, 'success');
  assert.match(status.review.state, /Fixture review/);
  console.log('PASS: actual PKCE session/fire/progress/upload/status handlers create one mocked PR with verified App JWT and co-author');

  const newHead = '9'.repeat(40);
  async function webhook(event, payload, delivery, valid = true) {
    const raw = JSON.stringify({ repository: { full_name: 'LYJW131/lyjwpage' }, ...payload });
    const signature = createHmac('sha256', valid ? fixtureSecret : 'invalid-fixture-secret').update(raw).digest('hex');
    return fetch(`${worker}/api/build/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': event, 'X-GitHub-Delivery': delivery, 'X-Hub-Signature-256': `sha256=${signature}` }, body: raw });
  }
  const prPayload = { number: 101, state: 'open', merged: false, html_url: 'https://github.com/LYJW131/lyjwpage/pull/101', head: { ref: build.branch, sha: newHead, repo: { full_name: 'LYJW131/lyjwpage' } }, base: { ref: 'main' }, updated_at: new Date(Date.now() + 1000).toISOString() };
  assert.equal((await webhook('pull_request', { pull_request: prPayload }, 'bad-signature', false)).status, 401);
  assert.equal((await webhook('pull_request', { pull_request: prPayload }, 'new-head')).status, 200);
  const current = (await rpc('global', 'readRun', build.runId)).state;
  assert.equal(current.pr.headSha, newHead);
  assert.equal(current.ci.state, 'unknown');
  assert.equal(current.preview.state, 'unknown');
  await rpc('global', 'updateRun', build.runId, { pr: { ...current.pr, headSha }, ci: { state: 'success', updatedAt: Date.now() + 10_000 } }, headSha);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.pr.headSha, newHead);
  assert.equal((await webhook('status', { sha: headSha, context: 'Vercel', state: 'success', updated_at: new Date(Date.now() + 20_000).toISOString() }, 'stale-head-status')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.preview.state, 'unknown');
  assert.equal((await webhook('pull_request', { pull_request: { ...prPayload, state: 'closed', merged: true } }, 'new-head')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'pr_open');
  assert.equal((await webhook('issue_comment', { issue: { number: 101 }, comment: { user: { login: 'someone' }, body: 'Approved', html_url: 'https://example.test/comment', updated_at: new Date().toISOString() } }, 'untrusted-review')).status, 200);
  assert.match((await rpc('global', 'readRun', build.runId)).state.review.state, /Fixture review/);
  assert.equal((await webhook('issue_comment', { issue: { number: 101 }, comment: { user: { login: 'claude[bot]' }, body: 'Fixture advisory review received.', html_url: 'https://github.com/LYJW131/lyjwpage/pull/101#issuecomment-2', updated_at: new Date(Date.now() + 2000).toISOString() } }, 'trusted-review')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.review.state, 'Fixture advisory review received.');
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'pr_open');
  assert.equal((await webhook('pull_request', { pull_request: { ...prPayload, state: 'closed', merged: true, updated_at: new Date(Date.now() + 3000).toISOString() } }, 'merged')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'merged');
  assert.equal((await webhook('pull_request', { pull_request: { ...prPayload, updated_at: new Date(Date.now() + 4000).toISOString() } }, 'late-open')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'merged');
  assert.equal(await rpc('global', 'hasDelivery', 'merged'), true);
  const githubCalls = (await inspect()).calls.length;
  assert.equal((await (await getStatus()).json()).phase, 'merged');
  assert.equal((await inspect()).calls.length, githubCalls);
  console.log('PASS: signed webhooks deduplicate deliveries, reject stale-head updates and merged status does not reconcile');

  for (const [scenario, changedUpload, errorPattern] of [
    [{ ancestor: true }, { ...upload, files: [{ ...upload.files[0], path: 'src/package.json' }] }, /protected|allowed|blocked/i],
    [{ ancestor: false }, upload, /main history/i],
  ]) {
    await post('/__fixture/configure', scenario);
    const nextPlan = await (await post('/__fixture/plan', plan)).json();
    const nextResponse = await post('/api/build', { session, planToken: nextPlan.token });
    assert.equal(nextResponse.status, 202);
    const nextBuild = await nextResponse.json();
    const nextFire = (await inspect()).fires.find((entry) => entry.runId === nextBuild.runId);
    const before = (await inspect()).calls.filter((call) => call.method === 'POST' && call.path.startsWith('api.github.com/repos/')).length;
    const rejected = await post(`/api/build/upload?runId=${nextBuild.runId}`, changedUpload, { Authorization: `Bearer ${nextFire.uploadToken}` });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, errorPattern);
    assert.equal((await rpc('global', 'readRun', nextBuild.runId)).state.phase, 'blocked');
    assert.equal((await inspect()).calls.filter((call) => call.method === 'POST' && call.path.startsWith('api.github.com/repos/')).length, before);
  }
  console.log('PASS: forbidden uploads and bases outside main are blocked before any GitHub write');

  await stop(child);
  child = start();
  await ready();
  assert.equal((await rpc('global', 'readRun', build.runId)).state.pr.headSha, newHead);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'merged');
  assert.equal(await rpc('global', 'hasDelivery', 'merged'), true);
  assert.equal((await rpc('upload-race', 'readRun', uploadRun.state.runId)).uploadUsed, true);
  assert.equal(await rpc('plan-race', 'claimPlan', 'same-plan', expiresAt), false);
  assert.equal((await rpc('design-quota', 'admitDesign', designId)).status, 'exhausted');
  assert.equal(await rpc('account-quota', 'reserveRun', storedRun('3'.repeat(32)), 'persisted-quota-plan', Date.now() + BUILD_STATUS_TTL_MS), 'account');
  console.log('PASS: real workerd restart preserves run state, one-time claims, design turns and account quotas');
  assert.equal(logs.some((line) => /Cannot perform I\/O|Uncaught|SQLITE_ERROR/.test(line)), false, 'No workerd isolation or SQLite errors');
} catch (error) {
  const diagnostic = stripVTControlCharacters(logs.join('')).split('\n').filter((line) => /error|Error|failed|Failed|ready on/i.test(line)).slice(-12).join('\n');
  console.error(diagnostic.replaceAll(fixtureSecret, '[fixture]').replace(/eyJ[A-Za-z0-9_.-]+/g, '[token]'));
  throw error;
} finally {
  await Promise.all(children.map(stop));
  await rm(temporary, { recursive: true, force: true });
}
