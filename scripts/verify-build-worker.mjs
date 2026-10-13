#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync, createHmac, createHash, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import '../src/lib/testing/register-alias.mjs';

const { packageBuild, runGate, runPublish } = await import('./build-actions.mjs');
const { BUILD_DESIGN_LIMITS, BUILD_QUOTA, BUILD_STATUS_TTL_MS, BUILD_TIMEOUT_MS, branchForRun } = await import('../shared/build-routine.ts');

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'workers/ai/package.json'));
const temporary = await mkdtemp(join(tmpdir(), 'lyjw-build-verify-'));
const children = [];
const logs = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const baseSha = 'a'.repeat(40);
const fixtureSecret = 'local-build-fixture-only';
const plan = { title: 'Improve the fixture card', spec: 'Render the fixture card clearly.', acceptance: ['Readable on a phone'], paths: ['src/components/fixture.tsx'] };
const oidcKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const oidcJwks = { keys: [{ ...oidcKeys.publicKey.export({ format: 'jwk' }), kid: 'fixture-oidc', alg: 'RS256', use: 'sig' }] };
const buildWorkflowRef = 'LYJW131/lyjwpage/.github/workflows/build.yml@refs/heads/main';
const screenshot = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).toString('base64');

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

function actionsToken(audience, patch = {}) {
  const iat = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = { iss: 'https://token.actions.githubusercontent.com', aud: audience, repository: 'LYJW131/lyjwpage', repository_id: '1331086735', repository_owner_id: '153256373', workflow_ref: buildWorkflowRef, job_workflow_ref: buildWorkflowRef, event_name: 'repository_dispatch', ref: 'refs/heads/main', runner_environment: 'github-hosted', iat, nbf: iat - 600, exp: iat + 300, ...patch };
  const body = `${encode({ alg: 'RS256', typ: 'JWT', kid: 'fixture-oidc' })}.${encode(claims)}`;
  return `${body}.${sign('sha256', Buffer.from(body), oidcKeys.privateKey).toString('base64url')}`;
}

const uploadCapability = (runId) => createHmac('sha256', fixtureSecret).update(`build-upload:${runId}`).digest('base64url');

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
      BUILD_SESSION_SECRET: fixtureSecret, GITHUB_WEBHOOK_SECRET: fixtureSecret, GITHUB_APP_CLIENT_SECRET: fixtureSecret,
      GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      FIXTURE_PUBLIC_JWK: JSON.stringify(publicKey.export({ format: 'jwk' })),
      FIXTURE_OIDC_JWKS: JSON.stringify(oidcJwks),
    },
    r2_buckets: [{ binding: 'IMAGES', bucket_name: 'fixture-images' }],
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
  const dispatchedRun = storedRun('1'.repeat(32));
  const uploadRun = { ...dispatchedRun, callbackOrigin: 'https://api.homepage.lyjw.llc', planCommitSha: 'b'.repeat(40), dispatchAttempted: true, state: { ...dispatchedRun.state, pr: { number: 7, url: 'https://github.com/LYJW131/lyjwpage/pull/7', headSha: 'b'.repeat(40), draft: true } } };
  assert.equal(await rpc('upload-race', 'reserveRun', uploadRun, 'upload-plan', expiresAt), 'ok');
  const uploads = await Promise.all(Array.from({ length: 16 }, () => rpc('upload-race', 'claimUpload', uploadRun.state.runId, uploadRun.uploadHash)));
  assert.equal(uploads.filter(Boolean).length, 1);
  assert.equal((await rpc('upload-race', 'readRun', uploadRun.state.runId)).state.phase, 'uploaded');
  console.log('PASS: real Durable Object RPC and SQLite transactions consume concurrent plan/upload claims once');

  const overflow = 5;
  const designIds = Array.from({ length: BUILD_DESIGN_LIMITS.everyone + overflow }, (_, index) => `design-${index}`);
  const designResults = await Promise.all(designIds.map((id) => rpc('design-quota', 'createDesign', id, Date.now() + BUILD_DESIGN_LIMITS.ttlMs - 1000)));
  assert.equal(designResults.filter(Boolean).length, BUILD_DESIGN_LIMITS.everyone);
  const designId = designIds[designResults.findIndex(Boolean)];
  const turns = await Promise.all(Array.from({ length: BUILD_DESIGN_LIMITS.maxTurns + overflow }, () => rpc('design-quota', 'admitDesign', designId)));
  assert.equal(turns.filter((result) => result.status === 'ok').length, BUILD_DESIGN_LIMITS.maxTurns);
  assert.equal(turns.filter((result) => result.status === 'exhausted').length, overflow);
  assert.equal((await rpc('design-quota', 'admitDesign', 'missing')).status, 'expired');
  console.log(`PASS: concurrent planning admission enforces ${BUILD_DESIGN_LIMITS.everyone} sessions per hour and ${BUILD_DESIGN_LIMITS.maxTurns} turns per session`);

  const accountRuns = await Promise.all(Array.from({ length: BUILD_QUOTA.fire.account + overflow }, (_, index) => rpc('account-quota', 'reserveRun', storedRun((100 + index).toString(16).padStart(32, '0'), `same-account-${index ? 'renamed' : 'initial'}`), `account-plan-${index}`, expiresAt)));
  assert.equal(accountRuns.filter((result) => result === 'ok').length, BUILD_QUOTA.fire.account);
  assert.equal(accountRuns.filter((result) => result === 'account').length, overflow);
  const siteRuns = await Promise.all(Array.from({ length: BUILD_QUOTA.fire.everyone + overflow }, (_, index) => rpc('site-quota', 'reserveRun', storedRun((200 + index).toString(16).padStart(32, '0'), `visitor-${index + 1}`), `site-plan-${index}`, expiresAt)));
  assert.equal(siteRuns.filter((result) => result === 'ok').length, BUILD_QUOTA.fire.everyone);
  assert.equal(siteRuns.filter((result) => result === 'site').length, overflow);
  console.log(`PASS: persisted build quotas enforce ${BUILD_QUOTA.fire.account} per GitHub account and ${BUILD_QUOTA.fire.everyone} site-wide without races`);

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
  assert.equal((await inspect()).dispatches.length, 0);
  await post('/__fixture/configure', { mainUnavailable: false, delayDispatchMs: 1500 });
  const fires = await Promise.all(Array.from({ length: 8 }, () => post('/api/build', { ...signIn, planToken: proposal.token })));
  assert.equal(fires.filter((response) => response.status === 202).length, 8);
  const fireResults = await Promise.all(fires.map((response) => response.json()));
  assert.equal(new Set(fireResults.map((result) => result.runId)).size, 1);
  const build = fireResults.find((result) => result.run?.pr) ?? fireResults[0];
  const fixture = await eventually(async () => { const snapshot = await inspect(); assert.equal(snapshot.dispatches.length, 1); return snapshot; });
  assert.deepEqual(fixture.answered, []);
  assert.ok(build.run.pr?.draft);
  await eventually(async () => assert.deepEqual((await inspect()).answered, [build.runId]));
  assert.equal((await rpc('global', 'readRun', build.runId)).state.reason, undefined);
  await post('/__fixture/configure', { delayDispatchMs: 0 });
  console.log('PASS: ExecutionContext.waitUntil returns the draft PR response before the build workflow dispatch is answered');
  const installationCalls = fixture.calls.filter((call) => call.path.endsWith('/access_tokens'));
  assert.ok(installationCalls.length > BUILD_QUOTA.fire.account);
  assert.ok(installationCalls.filter((call) => call.body.permissions.contents === 'read').every((call) => Object.values(call.body.permissions).every((permission) => permission === 'read')));
  assert.ok(installationCalls.some((call) => call.body.permissions.contents === 'write' && call.body.permissions.pull_requests === 'write'));
  const prepared = await rpc('global', 'readRun', build.runId);
  assert.equal(prepared.state.pr.draft, true);
  assert.equal(prepared.state.pr.headSha, prepared.planCommitSha);
  assert.equal(fixture.prs.length, 1);
  const planCommit = fixture.objects.find((object) => object.key === `commit:${prepared.planCommitSha}`).value;
  assert.deepEqual(planCommit.parents, [{ sha: baseSha }]);
  const planTree = fixture.objects.find((object) => object.key === `tree:${planCommit.tree.sha}`).value;
  const planFile = planTree.find((entry) => entry.path === `builds/${build.runId}.md`);
  assert.ok(planFile);
  const planBlob = fixture.objects.find((object) => object.key === `blob:${planFile.sha}`).value;
  assert.match(planBlob.content, /Render the fixture card clearly/);
  assert.doesNotMatch(planBlob.content, /fixture-visitor|uploadToken|Fixture Visitor/);
  console.log('PASS: main uses a read-only App installation token and repeated read failures do not consume the plan or build quota');
  const callbackOrigin = prepared.callbackOrigin;
  assert.match(callbackOrigin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
  assert.deepEqual(fixture.dispatches[0], { runId: build.runId, planCommitSha: prepared.planCommitSha, baseSha, prNumber: prepared.state.pr.number, callbackOrigin });
  assert.equal(fixture.calls.find((call) => call.path.endsWith('/dispatches')).body.event_type, 'build');
  const exchanges = fixture.calls.filter((call) => call.path.includes('/login/oauth/access_token')).length;
  assert.ok(exchanges > BUILD_QUOTA.fire.account);
  assert.equal(fixture.calls.filter((call) => call.method === 'DELETE' && call.path.includes('/applications/')).length, exchanges);
  assert.equal((await webhook('pull_request', { pull_request: fixture.prs[0] }, 'plan-only-draft')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'triggered');
  assert.equal((await rpc('global', 'readRun', build.runId)).state.pr.draft, true);
  const workflowAuth = { Authorization: `Bearer ${actionsToken(callbackOrigin)}` };
  for (const authorization of [`Bearer ${uploadCapability(build.runId)}`, `Bearer ${actionsToken('https://api.homepage.lyjw.llc')}`, `Bearer ${actionsToken(callbackOrigin, { workflow_ref: 'LYJW131/lyjwpage/.github/workflows/ci.yml@refs/heads/main' })}`, `Bearer ${actionsToken(callbackOrigin, { runner_environment: 'self-hosted' })}`]) {
    assert.equal((await post(`/api/build/progress?runId=${build.runId}`, { message: 'Forged progress.' }, { Authorization: authorization })).status, 401);
    assert.equal((await post(`/api/build/upload?runId=${build.runId}`, { baseSha }, { Authorization: authorization })).status, 401);
  }
  assert.equal((await rpc('global', 'readRun', build.runId)).uploadUsed, false);
  const progress = await post(`/api/build/progress?runId=${build.runId}`, { message: 'Fixture implementation underway.' }, workflowAuth);
  assert.equal(progress.status, 200);
  assert.equal((await post(`/api/build/screenshot?runId=${build.runId}`, { caption: 'Fixture card on a phone', content: screenshot }, workflowAuth)).status, 201);
  const getStatus = () => fetch(`${worker}/api/build/status?runId=${build.runId}`, { headers: { Authorization: `Bearer ${build.statusToken}` } });
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'running');
  const upload = { baseSha, message: 'feat: improve fixture card', files: [{ path: 'src/components/fixture.tsx', content: Buffer.from('export const fixture = true;\n').toString('base64'), mode: '100644' }], deletions: [] };
  const uploaded = await Promise.all(Array.from({ length: 8 }, () => post(`/api/build/upload?runId=${build.runId}`, upload, workflowAuth)));
  assert.equal(uploaded.filter((response) => response.status === 201).length, 1);
  assert.equal(uploaded.filter((response) => response.status === 401).length, 7);
  assert.equal((await post(`/api/build/progress?runId=${build.runId}`, { message: 'Too late' }, workflowAuth)).status, 401);
  assert.equal((await post(`/api/build/screenshot?runId=${build.runId}`, { caption: 'Too late', content: screenshot }, workflowAuth)).status, 409);
  const afterUpload = await inspect();
  assert.equal(afterUpload.jwtVerified, true);
  const writes = afterUpload.calls.filter((call) => call.method === 'POST' && call.path.startsWith('api.github.com/repos/'));
  assert.equal(writes.filter((call) => call.path.endsWith('/git/refs')).length, 1);
  assert.equal(writes.filter((call) => call.path.endsWith('/pulls')).length, 1);
  assert.equal(writes.find((call) => call.path.endsWith('/git/refs')).body.ref, `refs/heads/${build.branch}`);
  assert.equal(writes.find((call) => call.path.endsWith('/pulls')).body.draft, true);
  const implementation = writes.filter((call) => call.path.endsWith('/git/commits')).at(-1);
  assert.match(implementation.body.message, /Co-authored-by: Fixture Visitor/);
  assert.deepEqual(implementation.body.parents, [prepared.planCommitSha]);
  const published = await rpc('global', 'readRun', build.runId);
  const headSha = published.implementationHeadSha;
  assert.equal(published.state.pr.number, prepared.state.pr.number);
  assert.equal(published.state.pr.draft, true);
  assert.equal(published.state.pr.headSha, headSha);
  const implementationTree = afterUpload.objects.find((object) => object.key === `tree:${implementation.body.tree}`).value;
  assert.ok(implementationTree.some((entry) => entry.path === `builds/${build.runId}.md` && entry.sha === planFile.sha));
  assert.ok(implementationTree.some((entry) => entry.path === upload.files[0].path));
  assert.equal(afterUpload.calls.filter((call) => call.path === 'api.github.com/graphql').length, 0);
  assert.equal(afterUpload.calls.filter((call) => call.method === 'POST' && call.path === `api.github.com/repos/LYJW131/lyjwpage/issues/${prepared.state.pr.number}/comments`).length, 1);
  assert.ok(afterUpload.calls.some((call) => call.path === 'token.actions.githubusercontent.com/.well-known/jwks'));
  const status = await (await getStatus()).json();
  assert.equal(status.phase, 'pr_open');
  assert.equal(status.pr.number, 101);
  assert.equal(status.pr.draft, false);
  assert.equal(status.ci.state, 'success');
  assert.equal(status.preview.state, 'success');
  assert.match(status.review.state, /Fixture review/);
  assert.equal((await inspect()).calls.filter((call) => call.path === 'api.github.com/graphql').length, 1);
  console.log('PASS: concurrent Build clicks return one run, draft PR and plan file before one dispatch; only build workflow OIDC tokens for the callback origin report, and one upload continues the same branch and becomes ready only after implementation CI');

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
  assert.equal(current.pr.headSha, headSha);
  assert.equal(current.ci.state, 'success');
  assert.equal(current.preview.state, 'success');
  await rpc('global', 'updateRun', build.runId, { pr: { ...current.pr, headSha: newHead }, ci: { state: 'success', updatedAt: Date.now() + 10_000 } }, newHead);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.pr.headSha, headSha);
  assert.equal((await webhook('status', { sha: newHead, context: 'ci/tests', state: 'success', updated_at: new Date(Date.now() + 20_000).toISOString() }, 'stale-head-status')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.preview.state, 'success');
  assert.equal((await webhook('pull_request', { pull_request: { ...prPayload, state: 'closed', merged: true } }, 'new-head')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'pr_open');
  assert.equal((await webhook('issue_comment', { issue: { number: 101 }, comment: { user: { login: 'someone' }, body: 'Approved', html_url: 'https://example.test/comment', updated_at: new Date().toISOString() } }, 'untrusted-review')).status, 200);
  assert.match((await rpc('global', 'readRun', build.runId)).state.review.state, /Fixture review/);
  assert.equal((await webhook('issue_comment', { issue: { number: 101 }, comment: { user: { login: 'claude[bot]' }, body: 'Fixture advisory review received.', html_url: 'https://github.com/LYJW131/lyjwpage/pull/101#issuecomment-2', updated_at: new Date(Date.now() + 2000).toISOString() } }, 'trusted-review')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.review.state, 'Fixture advisory review received.');
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'pr_open');
  assert.equal((await webhook('pull_request', { pull_request: { ...prPayload, head: { ...prPayload.head, sha: headSha }, state: 'closed', merged: true, updated_at: new Date(Date.now() + 3000).toISOString() } }, 'merged')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'merged');
  assert.equal((await webhook('pull_request', { pull_request: { ...prPayload, updated_at: new Date(Date.now() + 4000).toISOString() } }, 'late-open')).status, 200);
  assert.equal((await rpc('global', 'readRun', build.runId)).state.phase, 'merged');
  assert.equal(await rpc('global', 'hasDelivery', 'merged'), true);
  const githubCalls = (await inspect()).calls.length;
  assert.equal((await (await getStatus()).json()).phase, 'merged');
  assert.equal((await inspect()).calls.length, githubCalls);
  console.log('PASS: signed webhooks deduplicate deliveries, reject stale-head updates and merged status does not reconcile');

  let fixtureAccount = 200;
  async function nextBuild(scenario = {}) {
    fixtureAccount += 1;
    await post('/__fixture/configure', { accountId: fixtureAccount, account: `fixture-${fixtureAccount}`, ancestor: true, rejectPr: false, rejectBody: false, dispatchStatus: 0, check: 'success', ...scenario });
    const proposal = await (await post('/__fixture/plan', plan)).json();
    const response = await post('/api/build', { ...signIn, planToken: proposal.token });
    assert.equal(response.status, 202);
    const build = await response.json();
    if (!scenario.rejectPr) await eventually(async () => {
      assert.equal((await rpc('global', 'readRun', build.runId)).dispatchAttempted, true);
      assert.ok((await inspect()).answered.includes(build.runId));
    });
    const status = () => fetch(`${worker}/api/build/status?runId=${build.runId}`, { headers: { Authorization: `Bearer ${build.statusToken}` } });
    return { build, proposal, status };
  }
  async function uploadBuild(build, changedUpload = upload) {
    assert.ok((await inspect()).dispatches.some((entry) => entry.runId === build.runId));
    return post(`/api/build/upload?runId=${build.runId}`, changedUpload, { Authorization: `Bearer ${actionsToken(callbackOrigin)}` });
  }

  const preparing = await nextBuild({ rejectPr: true, refResponseLost: true });
  const unconfirmed = await rpc('global', 'readRun', preparing.build.runId);
  assert.equal(unconfirmed.state.phase, 'triggered');
  assert.equal(unconfirmed.state.pr, undefined);
  assert.equal((await inspect()).dispatches.some((dispatch) => dispatch.runId === preparing.build.runId), false);
  const retainedBranch = (await inspect()).objects.find((object) => object.key === `branch:${preparing.build.branch}`).value;
  await post('/__fixture/configure', { rejectPr: false, prResponseLost: true });
  const retry = await post('/api/build', { ...signIn, planToken: preparing.proposal.token });
  assert.equal(retry.status, 202);
  assert.equal((await retry.json()).runId, preparing.build.runId);
  assert.equal((await rpc('global', 'readRun', preparing.build.runId)).planCommitSha, retainedBranch);
  await eventually(async () => assert.equal((await inspect()).dispatches.filter((dispatch) => dispatch.runId === preparing.build.runId).length, 1));
  assert.equal((await inspect()).prs.filter((pr) => pr.head.ref === preparing.build.branch).length, 1);
  console.log('PASS: partially successful ref and PR requests retain the plan branch, recover the same draft and dispatch once');

  const recovering = await nextBuild({ rejectBody: true });
  assert.equal((await uploadBuild(recovering.build)).status, 502);
  const failedPublication = await rpc('global', 'readRun', recovering.build.runId);
  assert.equal(failedPublication.state.phase, 'failed');
  assert.ok(failedPublication.implementationHeadSha);
  assert.ok(failedPublication.publicationBody);
  assert.equal(failedPublication.state.pr.headSha, failedPublication.planCommitSha);
  assert.equal((await uploadBuild(recovering.build)).status, 401);
  await post('/__fixture/configure', { rejectBody: false, pushResponseLost: true });
  const recovered = await (await recovering.status()).json();
  assert.equal(recovered.phase, 'pr_open');
  assert.equal(recovered.pr.headSha, failedPublication.implementationHeadSha);
  assert.equal(recovered.pr.number, failedPublication.state.pr.number);
  assert.equal(recovered.pr.draft, false);
  assert.equal((await inspect()).prs.filter((pr) => pr.head.ref === recovering.build.branch).length, 1);
  console.log('PASS: status polling recovers persisted implementation and PR body after publication failure and an ambiguous fast-forward response');

  const foreign = await nextBuild();
  const foreignPlan = (await rpc('global', 'readRun', foreign.build.runId)).planCommitSha;
  await post('/__fixture/configure', { branchHead: { branch: foreign.build.branch, sha: newHead } });
  const foreignUpload = await uploadBuild(foreign.build);
  assert.equal(foreignUpload.status, 400);
  assert.equal((await rpc('global', 'readRun', foreign.build.runId)).state.phase, 'blocked');
  assert.equal((await rpc('global', 'readRun', foreign.build.runId)).state.pr.headSha, foreignPlan);
  assert.equal((await inspect()).objects.find((object) => object.key === `branch:${foreign.build.branch}`).value, newHead);
  console.log('PASS: an unexpected branch head is neither overwritten nor adopted');

  let unconfirmedDispatch;
  for (const [dispatchStatus, phase, reason] of [[422, 'failed', /GitHub rejected the build workflow dispatch/], [503, 'triggered', /build workflow result is unknown/]]) {
    const dispatchFailure = await nextBuild({ dispatchStatus });
    if (phase === 'triggered') unconfirmedDispatch = dispatchFailure;
    await eventually(async () => assert.match((await rpc('global', 'readRun', dispatchFailure.build.runId)).state.reason ?? '', reason));
    const failedDispatch = await (await dispatchFailure.status()).json();
    assert.equal(failedDispatch.phase, phase);
    assert.equal(failedDispatch.pr.draft, true);
    await post('/api/build', { ...signIn, planToken: dispatchFailure.proposal.token });
    await dispatchFailure.status();
    assert.equal((await inspect()).dispatches.filter((dispatch) => dispatch.runId === dispatchFailure.build.runId).length, 1);
  }
  console.log('PASS: rejected or unconfirmed workflow dispatch keeps the visible draft and retries never dispatch the same run again');

  const workflowOrigin = 'https://worker.test';
  const workflowIo = {
    fetch: (url, init) => String(url).startsWith('https://oidc.test/')
      ? Promise.resolve(Response.json({ value: actionsToken(callbackOrigin) }))
      : fetch(String(url).replace(workflowOrigin, worker), init),
    log: () => {},
  };
  const workflowEnv = async (run, extra) => {
    const outputs = join(temporary, `outputs-${run.build.runId}`);
    await writeFile(outputs, '');
    return { outputs, env: { RUN_ID: run.build.runId, BASE_SHA: baseSha, PR_NUMBER: String((await rpc('global', 'readRun', run.build.runId)).state.pr.number), CALLBACK_ORIGIN: workflowOrigin, RUN_URL: 'https://github.com/LYJW131/lyjwpage/actions/runs/1', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.test/token?api-version=2.0', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'fixture', GITHUB_OUTPUT: outputs, ...extra } };
  };
  const declined = unconfirmedDispatch;
  const declinedGate = await workflowEnv(declined, { REVIEW_RESULT: 'success', VERDICT: 'reject', REASON: 'The plan needs a deploy change.' });
  await runGate({ env: declinedGate.env, io: workflowIo });
  assert.match(await readFile(declinedGate.outputs, 'utf8'), /^approved<<\S+\nfalse\n/);
  const declinedRun = (await rpc('global', 'readRun', declined.build.runId)).state;
  assert.equal(declinedRun.phase, 'blocked');
  assert.equal(declinedRun.reason, 'The builder stopped without uploading: Plan review declined: The plan needs a deploy change.');

  const scripted = await nextBuild({ check: 'cancelled' });
  const gate = await workflowEnv(scripted, { REVIEW_RESULT: 'success', VERDICT: 'approve', REASON: 'Small card change.' });
  await runGate({ env: gate.env, io: workflowIo });
  assert.match(await readFile(gate.outputs, 'utf8'), /^approved<<\S+\ntrue\n/);
  assert.equal((await rpc('global', 'readRun', scripted.build.runId)).state.phase, 'running');
  const checkout = join(temporary, 'scripted-checkout');
  const gitIn = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();
  await mkdir(join(checkout, 'builds'), { recursive: true });
  await writeFile(join(checkout, `builds/${scripted.build.runId}.md`), '# Plan\n');
  gitIn(temporary, 'init', '-q', checkout);
  gitIn(checkout, 'add', '-A');
  gitIn(checkout, 'commit', '-q', '-m', 'plan');
  const scriptedPlanSha = gitIn(checkout, 'rev-parse', 'HEAD');
  gitIn(temporary, 'clone', '-q', checkout, join(temporary, 'scripted-work'));
  await mkdir(join(checkout, 'src/components'), { recursive: true });
  await writeFile(join(checkout, 'src/components/fixture.tsx'), 'export const fixture = "scripted";\n');
  await mkdir(join(checkout, '.build-output/screenshots'), { recursive: true });
  await writeFile(join(checkout, '.build-output/message.md'), 'feat(fixture): 脚本上传\n\n经 build-actions 打包。\n');
  await writeFile(join(checkout, '.build-output/screenshots/card.png'), Buffer.from(screenshot, 'base64'));
  await writeFile(join(checkout, '.build-output/screenshots.json'), JSON.stringify([{ file: 'card.png', caption: 'Fixture card, desktop 1440px' }]));
  packageBuild({ cwd: checkout, out: join(temporary, 'scripted-artifact'), planCommitSha: scriptedPlanSha, io: workflowIo });
  const { env: publishEnv } = await workflowEnv(scripted, { IMPLEMENT_RESULT: 'success' });
  assert.equal(await runPublish({ env: publishEnv, work: join(temporary, 'scripted-work'), artifact: join(temporary, 'scripted-artifact'), io: workflowIo }), true);
  assert.equal((await rpc('global', 'readRun', scripted.build.runId)).screenshots.length, 1);
  const scriptedCommit = (await inspect()).calls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/commits')).at(-1);
  assert.match(scriptedCommit.body.message, /^feat\(fixture\): 脚本上传\n\n经 build-actions 打包。\n\nCo-authored-by: /);
  const cancelledStatus = await (await scripted.status()).json();
  assert.equal(cancelledStatus.phase, 'pr_open');
  assert.equal(cancelledStatus.ci.state, 'failure');
  assert.equal(cancelledStatus.pr.draft, true);
  console.log('PASS: scripts/build-actions.mjs gate and publish work against the real Worker (a declined review blocks the run; an approved one uploads the packaged patch, message and screenshot), and cancelled implementation CI keeps the PR draft');


  for (const [scenario, changedUpload, errorPattern] of [
    [{ ancestor: true }, { ...upload, files: [{ ...upload.files[0], path: 'src/package.json' }] }, /protected|allowed|blocked/i],
    [{ ancestor: false }, upload, /main history/i],
  ]) {
    const next = await nextBuild();
    await post('/__fixture/configure', scenario);
    const before = (await inspect()).calls.filter((call) => call.method === 'POST' && call.path.startsWith('api.github.com/repos/')).length;
    const rejected = await uploadBuild(next.build, changedUpload);
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, errorPattern);
    assert.equal((await rpc('global', 'readRun', next.build.runId)).state.phase, 'blocked');
    assert.equal((await inspect()).calls.filter((call) => call.method === 'POST' && call.path.startsWith('api.github.com/repos/')).length, before);
  }
  console.log('PASS: forbidden uploads and bases outside main are blocked before implementation writes');

  await stop(child);
  child = start();
  await ready();
  assert.equal((await rpc('global', 'readRun', build.runId)).state.pr.headSha, headSha);
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
