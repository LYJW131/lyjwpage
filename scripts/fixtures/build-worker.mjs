import { DurableObject } from 'cloudflare:workers';

import { BuildCoordinator } from '../../workers/ai/src/build/coordinator.ts';
import { handleBuild, handleBuildProgress, handleBuildSession, handleBuildStatus, handleBuildUpload, handleGithubWebhook } from '../../workers/ai/src/build/handlers.ts';
import { issuePlan } from '../../workers/ai/src/build/plan.ts';

export { BuildCoordinator };

const repo = '/repos/LYJW131/lyjwpage';
const baseSha = 'a'.repeat(40);
const baseTree = 'b'.repeat(40);
const headSha = 'e'.repeat(40);
const json = (value, status = 200) => Response.json(value, { status });

export class BuildFixture extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_values (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_calls (method TEXT NOT NULL, path TEXT NOT NULL, body TEXT)');
  }

  get(key, fallback = null) {
    const rows = this.ctx.storage.sql.exec('SELECT value FROM fixture_values WHERE key = ?', key).toArray();
    return rows.length ? JSON.parse(rows[0].value) : fallback;
  }

  put(key, value) {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO fixture_values VALUES (?, ?)', key, JSON.stringify(value));
  }

  configure(value) {
    this.put('scenario', { ...this.get('scenario', {}), ...value });
  }

  inspect() {
    return {
      fires: this.get('fires', []),
      jwtVerified: this.get('jwtVerified', false),
      calls: this.ctx.storage.sql.exec('SELECT method, path, body FROM fixture_calls').toArray().map((call) => ({ ...call, body: call.body ? JSON.parse(call.body) : null })),
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const body = request.method === 'GET' ? null : await request.json().catch(() => null);
    const recordedBody = path.startsWith(`${repo}/git/`) || path === `${repo}/pulls` || path === '/app/installations/7/access_tokens' ? body : null;
    this.ctx.storage.sql.exec('INSERT INTO fixture_calls VALUES (?, ?, ?)', request.method, `${url.host}${path}`, recordedBody ? JSON.stringify(recordedBody) : null);
    const scenario = this.get('scenario', {});
    if (url.host === 'fixture.invalid' && path === '/fire') {
      if (request.headers.get('Authorization') !== `Bearer ${this.env.ROUTINE_FIRE_TOKEN}`) throw new Error('Fixture fire authorization failed');
      this.put('fires', [...this.get('fires', []), JSON.parse(body.text)]);
      return json({ claude_code_session_url: 'https://fixture.invalid/session' });
    }
    if (url.host === 'github.com' && path === '/login/oauth/access_token') return json({ access_token: 'fixture-user-token' });
    if (url.host !== 'api.github.com') throw new Error(`Blocked unexpected fixture host: ${url.host}`);
    if (path === '/user') return json({ id: scenario.accountId ?? 131, login: scenario.account ?? 'fixture-visitor', name: 'Fixture Visitor' });
    if (/^\/applications\/[^/]+\/token$/.test(path) && request.method === 'DELETE') return new Response(null, { status: 204 });
    if (path === `${repo}/git/ref/heads/main`) {
      if (request.headers.get('Authorization') !== 'Bearer fixture-readonly-token') throw new Error('Main must use a read-only installation token');
      return scenario.mainUnavailable ? json({ message: 'Fixture GitHub unavailable' }, 503) : json({ object: { sha: baseSha } });
    }
    if (path === `${repo}/installation`) {
      const token = request.headers.get('Authorization')?.slice(7) ?? '';
      const [header, payload, signature] = token.split('.');
      const decode = (value) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (letter) => letter.charCodeAt(0));
      const metadata = JSON.parse(new TextDecoder().decode(decode(header)));
      const key = await crypto.subtle.importKey('jwk', JSON.parse(this.env.FIXTURE_PUBLIC_JWK), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      if (metadata.alg !== 'RS256' || !await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(signature), new TextEncoder().encode(`${header}.${payload}`))) throw new Error('Fixture App JWT did not verify');
      this.put('jwtVerified', true);
      return json({ id: 7, permissions: { checks: 'read', statuses: 'read' } });
    }
    if (path === '/app/installations/7/access_tokens') return json({ token: body.permissions.contents === 'read' ? 'fixture-readonly-token' : 'fixture-installation-token' });
    if (path === `${repo}/compare/${baseSha}...main`) return json({ status: scenario.ancestor === false ? 'diverged' : 'ahead', merge_base_commit: { sha: scenario.ancestor === false ? 'f'.repeat(40) : baseSha } });
    if (path === `${repo}/git/commits/${baseSha}`) return json({ tree: { sha: baseTree } });
    if (path === `${repo}/git/trees/${baseTree}`) return json({ truncated: false, tree: [{ path: 'src', type: 'tree', mode: '040000' }, { path: 'src/components', type: 'tree', mode: '040000' }] });
    if (path === `${repo}/git/blobs` && request.method === 'POST') return json({ sha: 'c'.repeat(40) });
    if (path === `${repo}/git/trees` && request.method === 'POST') return json({ sha: 'd'.repeat(40) });
    if (path === `${repo}/git/commits` && request.method === 'POST') return json({ sha: headSha });
    if (path === `${repo}/git/refs` && request.method === 'POST') return json({ ref: body.ref, object: { sha: headSha } }, 201);
    if (path === `${repo}/pulls` && request.method === 'POST') {
      this.put('pr', { number: 101, html_url: 'https://github.com/LYJW131/lyjwpage/pull/101', head: { sha: headSha }, state: 'open', merged: false, updated_at: new Date().toISOString() });
      return json(this.get('pr'), 201);
    }
    if (path === `${repo}/pulls/101`) return json({ ...this.get('pr'), ...(scenario.pr ?? {}) });
    if (/\/commits\/[a-f0-9]{40}\/check-runs$/.test(path)) return json({ total_count: 2, check_runs: [
      { name: 'CI', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } },
      { name: 'Vercel', status: 'completed', conclusion: 'success', details_url: 'https://fixture-preview.example', app: { slug: 'vercel' } },
    ] });
    if (/\/commits\/[a-f0-9]{40}\/status$/.test(path)) return json({ state: 'success', total_count: 0, statuses: [] });
    if (path === `${repo}/issues/101/comments`) return json([{ user: { login: 'claude[bot]' }, body: 'Fixture review: no blocking concerns.', html_url: 'https://github.com/LYJW131/lyjwpage/pull/101#issuecomment-1', updated_at: new Date().toISOString() }]);
    throw new Error(`Unexpected fixture request: ${request.method} ${path}`);
  }
}

const rpcMethods = new Set(['createDesign', 'admitDesign', 'claimPlan', 'isPlanUsed', 'reserveRun', 'readRun', 'claimUpload', 'progress', 'updateRun', 'findRun', 'claimReconcile', 'hasDelivery', 'completeDelivery']);

const fixtureWorker = {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const fixture = env.BUILD_FIXTURE.getByName('global');
    const fetcher = (input, init) => fixture.fetch(new Request(input, init));
    if (path === '/__fixture/ready') return json({ ready: true });
    if (path === '/__fixture/inspect') return json(await fixture.inspect());
    if (path === '/__fixture/configure') { await fixture.configure(await request.json()); return json({ configured: true }); }
    if (path === '/__fixture/plan') return json(await issuePlan(env, await request.json()));
    if (path === '/__fixture/rpc') {
      const { name, method, args } = await request.json();
      if (!rpcMethods.has(method) || typeof name !== 'string' || !Array.isArray(args)) return json({ error: 'Invalid fixture RPC' }, 400);
      const stub = env.BUILD_COORDINATOR.getByName(name);
      return json(await stub[method](...args));
    }
    if (path === '/api/build/session') return handleBuildSession(request, env, fetcher);
    if (path === '/api/build') return handleBuild(request, env, fetcher);
    if (path === '/api/build/status') return handleBuildStatus(request, env, fetcher);
    if (path === '/api/build/upload') return handleBuildUpload(request, env, fetcher);
    if (path === '/api/build/progress') return handleBuildProgress(request, env);
    if (path === '/api/build/webhook') return handleGithubWebhook(request, env);
    return json({ error: 'Unknown fixture route' }, 404);
  },
};

export default fixtureWorker;
