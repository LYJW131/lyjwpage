import { DurableObject } from 'cloudflare:workers';

import { BuildCoordinator } from '../../workers/ai/src/build/coordinator.ts';
import { handleBuild, handleBuildProgress, handleBuildStatus, handleBuildUpload, handleGithubWebhook } from '../../workers/ai/src/build/handlers.ts';
import { issuePlan } from '../../workers/ai/src/build/plan.ts';

export { BuildCoordinator };

const repo = '/repos/LYJW131/lyjwpage';
const baseSha = 'a'.repeat(40);
const baseTree = 'b'.repeat(40);
const initialTree = [{ path: 'src', type: 'tree', mode: '040000' }, { path: 'src/components', type: 'tree', mode: '040000' }];
async function objectSha(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
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
    if (value.branchHead) {
      const { branch, sha } = value.branchHead;
      this.put(`branch:${branch}`, sha);
      const prs = this.get('prs', []);
      for (const pr of prs) if (pr.head.ref === branch) pr.head.sha = sha;
      this.put('prs', prs);
      delete value.branchHead;
    }
    this.put('scenario', { ...this.get('scenario', {}), ...value });
  }

  consumeFailure(scenario, name) {
    if (!scenario[name]) return false;
    this.configure({ [name]: false });
    return true;
  }

  inspect() {
    return {
      fires: this.get('fires', []),
      jwtVerified: this.get('jwtVerified', false),
      prs: this.get('prs', []),
      objects: this.ctx.storage.sql.exec("SELECT key, value FROM fixture_values WHERE key LIKE 'branch:%' OR key LIKE 'commit:%' OR key LIKE 'tree:%' OR key LIKE 'blob:%'").toArray().map((row) => ({ key: row.key, value: JSON.parse(row.value) })),
      calls: this.ctx.storage.sql.exec('SELECT method, path, body FROM fixture_calls').toArray().map((call) => ({ ...call, body: call.body ? JSON.parse(call.body) : null })),
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const body = request.method === 'GET' ? null : await request.json().catch(() => null);
    const recordedBody = path.startsWith(`${repo}/git/`) || path.startsWith(`${repo}/pulls`) || path === '/graphql' || path === '/app/installations/7/access_tokens' ? body : null;
    this.ctx.storage.sql.exec('INSERT INTO fixture_calls VALUES (?, ?, ?)', request.method, `${url.host}${path}${url.search}`, recordedBody ? JSON.stringify(recordedBody) : null);
    const scenario = this.get('scenario', {});
    if (url.host === 'fixture.invalid' && path === '/fire') {
      if (request.headers.get('Authorization') !== `Bearer ${this.env.ROUTINE_FIRE_TOKEN}`) throw new Error('Fixture fire authorization failed');
      const fired = JSON.parse(body.text);
      const pr = this.get('prs', []).find((entry) => entry.html_url === fired.prUrl);
      if (!pr?.draft || pr.head.ref !== fired.branch || pr.head.sha !== fired.planCommitSha) throw new Error('Routine must start after its matching draft is confirmed');
      this.put('fires', [...this.get('fires', []), fired]);
      if (scenario.delayDispatchMs) await new Promise((resolve) => setTimeout(resolve, scenario.delayDispatchMs));
      return scenario.rejectDispatch ? json({ error: 'Fixture dispatch rejected' }, 503) : json({ claude_code_session_url: 'https://claude.ai/code/session_fixture' });
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
    if (request.method !== 'GET' && (path.startsWith(`${repo}/git/`) || path.startsWith(`${repo}/pulls`) || path === '/graphql') && request.headers.get('Authorization') !== 'Bearer fixture-installation-token') throw new Error('GitHub mutations must use the write installation token');
    if (path === `${repo}/compare/${baseSha}...main`) return json({ status: scenario.ancestor === false ? 'diverged' : 'ahead', merge_base_commit: { sha: scenario.ancestor === false ? 'f'.repeat(40) : baseSha } });
    if (path === `${repo}/git/commits/${baseSha}`) return json({ sha: baseSha, tree: { sha: baseTree }, parents: [] });
    if (path === `${repo}/git/trees/${baseTree}`) return json({ truncated: false, tree: initialTree });
    if (path.startsWith(`${repo}/git/commits/`)) return json(this.get(`commit:${path.split('/').at(-1)}`));
    if (path.startsWith(`${repo}/git/trees/`)) return json({ truncated: false, tree: this.get(`tree:${path.split('/').at(-1)}`) });
    if (path === `${repo}/git/blobs` && request.method === 'POST') {
      const sha = await objectSha(body);
      this.put(`blob:${sha}`, body);
      return json({ sha });
    }
    if (path === `${repo}/git/trees` && request.method === 'POST') {
      const entries = new Map((body.base_tree === baseTree ? initialTree : this.get(`tree:${body.base_tree}`, [])).map((entry) => [entry.path, entry]));
      for (const entry of body.tree) { if (entry.sha === null) entries.delete(entry.path); else entries.set(entry.path, entry); }
      const tree = [...entries.values()];
      const sha = await objectSha(tree);
      this.put(`tree:${sha}`, tree);
      return json({ sha });
    }
    if (path === `${repo}/git/commits` && request.method === 'POST') {
      const sha = await objectSha(body);
      this.put(`commit:${sha}`, { sha, tree: { sha: body.tree }, parents: body.parents.map((sha) => ({ sha })), message: body.message });
      return json({ sha });
    }
    if (path.startsWith(`${repo}/git/ref/heads/`)) {
      const branch = path.slice(`${repo}/git/ref/heads/`.length);
      const sha = this.get(`branch:${branch}`);
      return sha ? json({ ref: `refs/heads/${branch}`, object: { sha } }) : json({}, 404);
    }
    if (path === `${repo}/git/refs` && request.method === 'POST') {
      const branch = body.ref.replace('refs/heads/', '');
      if (this.get(`branch:${branch}`)) return json({}, 422);
      this.put(`branch:${branch}`, body.sha);
      return this.consumeFailure(scenario, 'refResponseLost') ? json({}, 503) : json({ ref: body.ref, object: { sha: body.sha } }, 201);
    }
    if (path.startsWith(`${repo}/git/refs/heads/`) && request.method === 'PATCH') {
      const branch = path.slice(`${repo}/git/refs/heads/`.length);
      const head = this.get(`branch:${branch}`);
      const commit = this.get(`commit:${body.sha}`);
      if (body.force !== false || head !== body.sha && commit?.parents?.[0]?.sha !== head) return json({}, 422);
      this.put(`branch:${branch}`, body.sha);
      const prs = this.get('prs', []);
      for (const pr of prs) if (pr.head.ref === branch) pr.head.sha = body.sha;
      this.put('prs', prs);
      return this.consumeFailure(scenario, 'pushResponseLost') ? json({}, 503) : json({ ref: `refs/heads/${branch}`, object: { sha: body.sha } });
    }
    if (path === `${repo}/pulls` && request.method === 'GET') {
      const branch = url.searchParams.get('head')?.split(':')[1];
      return json(this.get('prs', []).filter((pr) => pr.head.ref === branch));
    }
    if (path === `${repo}/pulls` && request.method === 'POST') {
      if (scenario.rejectPr) return json({}, 422);
      const prs = this.get('prs', []);
      if (prs.some((pr) => pr.head.ref === body.head)) return json({}, 422);
      const number = 101 + prs.length;
      const pr = { number, node_id: `PR_fixture_${number}`, html_url: `https://github.com/LYJW131/lyjwpage/pull/${number}`, head: { sha: this.get(`branch:${body.head}`), ref: body.head, repo: { full_name: 'LYJW131/lyjwpage' } }, base: { ref: body.base, repo: { full_name: 'LYJW131/lyjwpage' } }, body: body.body, draft: body.draft, user: { id: 338272049, login: 'lyjw131[bot]', type: 'Bot' }, state: 'open', merged: false, updated_at: new Date().toISOString() };
      this.put('prs', [...prs, pr]);
      return this.consumeFailure(scenario, 'prResponseLost') ? json({}, 503) : json(pr, 201);
    }
    if (path.startsWith(`${repo}/pulls/`)) {
      const prs = this.get('prs', []);
      const pr = prs.find((entry) => entry.number === Number(path.split('/').at(-1)));
      if (!pr) return json({}, 404);
      if (request.method === 'PATCH') {
        if (scenario.rejectBody) return json({}, 503);
        pr.body = body.body;
        this.put('prs', prs);
      }
      return json(pr);
    }
    if (/\/commits\/[a-f0-9]{40}\/check-runs$/.test(path)) return json({ total_count: 2, check_runs: [
      { name: 'check', status: 'completed', conclusion: scenario.check ?? 'success', app: { slug: 'github-actions' } },
      { name: 'Vercel', status: 'completed', conclusion: 'success', details_url: 'https://fixture-preview.example', app: { slug: 'vercel' } },
    ] });
    if (/\/commits\/[a-f0-9]{40}\/status$/.test(path)) return json({ state: 'success', total_count: 0, statuses: [] });
    if (/\/issues\/\d+\/comments$/.test(path)) return json([{ user: { login: 'claude[bot]' }, body: 'Fixture review: no blocking concerns.', html_url: 'https://github.com/LYJW131/lyjwpage/pull/101#issuecomment-1', updated_at: new Date().toISOString() }]);
    if (path === '/graphql') {
      const prs = this.get('prs', []);
      const pr = prs.find((entry) => entry.node_id === body.variables.id);
      if (!pr) return json({ errors: [{ message: 'Unknown PR' }] });
      const operation = body.query.includes('convertPullRequestToDraft') ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview';
      pr.draft = operation === 'convertPullRequestToDraft';
      this.put('prs', prs);
      return json({ data: { [operation]: { pullRequest: { number: pr.number, isDraft: pr.draft, headRefOid: pr.head.sha } } } });
    }
    throw new Error(`Unexpected fixture request: ${request.method} ${path}`);
  }
}

const rpcMethods = new Set(['createDesign', 'admitDesign', 'claimPlan', 'isPlanUsed', 'reserveRun', 'readRun', 'claimUpload', 'progress', 'updateRun', 'findRun', 'claimReconcile', 'hasDelivery', 'completeDelivery']);

const fixtureWorker = {
  async fetch(request, env, ctx) {
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
    if (path === '/api/build') return handleBuild(request, env, fetcher, ctx);
    if (path === '/api/build/status') return handleBuildStatus(request, env, fetcher, ctx);
    if (path === '/api/build/upload') return handleBuildUpload(request, env, fetcher);
    if (path === '/api/build/progress') return handleBuildProgress(request, env);
    if (path === '/api/build/webhook') return handleGithubWebhook(request, env);
    return json({ error: 'Unknown fixture route' }, 404);
  },
};

export default fixtureWorker;
