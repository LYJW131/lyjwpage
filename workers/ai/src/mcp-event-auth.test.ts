import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { authenticateEventPrincipal, eventAuthentication, eventAuthChallenge, eventCallbackHosts, eventPrincipalAllowed, eventResourceMetadata, eventsConfigured, MCP_EVENT_AUTH_LIMITS, type McpEventAuthEnv } from './mcp-event-auth.ts';

const first = generateKeyPairSync('rsa', { modulusLength: 2048 });
const second = generateKeyPairSync('rsa', { modulusLength: 2048 });
const firstJwk = { ...first.publicKey.export({ format: 'jwk' }), kid: 'key-a', alg: 'RS256', use: 'sig' };
const secondJwk = { ...second.publicKey.export({ format: 'jwk' }), kid: 'key-b', alg: 'RS256', use: 'sig' };
const client = { principal: 'client-a', subject: 'user-subject-a' };
const issuer = 'https://auth.example.com';
const resource = 'https://api.example.com/mcp';
let fixtureId = 0;

function jwt(payload: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = first.privateKey): string {
  const now = Math.floor(Date.now() / 1000);
  const parts = [
    { alg: 'RS256', kid: 'key-a', typ: 'at+jwt', ...header },
    { iss: issuer, aud: resource, sub: client.subject, scope: 'mcp:events', exp: now + 3600, iat: now, ...payload },
  ].map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'));
  const body = parts.join('.');
  return `${body}.${sign('RSA-SHA256', Buffer.from(body), key).toString('base64url')}`;
}

const request = (token?: string) => new Request('http://127.0.0.1:8787/mcp', { headers: token ? { Authorization: `Bearer ${token}` } : {} });

function fixture(t: TestContext, reply: () => Response | Promise<Response> = () => Response.json({ keys: [firstJwk] })) {
  const config = { issuer, resource, jwksUrl: `${issuer}/jwks/${++fixtureId}` };
  const env: McpEventAuthEnv = {
    MCP_EVENT_AUTH: JSON.stringify(config),
    MCP_EVENT_CLIENTS: JSON.stringify([client]),
    MCP_EVENT_CALLBACK_HOSTS: 'callback.example.com',
  };
  const fetcher = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, config.jwksUrl);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    assert.equal(new Headers(init.headers).get('Authorization'), null);
    return reply();
  });
  return { env, config, fetcher, get fetches() { return fetcher.mock.callCount(); } };
}

test('events need valid OAuth configuration, allowed subjects and exact callback hosts', (t) => {
  const f = fixture(t);
  assert.equal(eventsConfigured(f.env), true);
  assert.equal(eventsConfigured({}), false);
  for (const patch of [{ MCP_EVENT_AUTH: '' }, { MCP_EVENT_CALLBACK_HOSTS: '' }, { MCP_EVENT_CLIENTS: '{}' }, { MCP_EVENT_CLIENTS: '[]' }]) {
    assert.equal(eventsConfigured({ ...f.env, ...patch }), false);
    assert.equal(eventResourceMetadata({ ...f.env, ...patch }), null);
    assert.equal(eventAuthChallenge({ ...f.env, ...patch }), null);
  }
  assert.deepEqual(eventCallbackHosts({ MCP_EVENT_CALLBACK_HOSTS: 'callback.example.com, callback.example.com' }), ['callback.example.com']);
  for (const host of ['*.example.com', 'https://callback.example.com', 'callback.example.com/path', 'callback.example.com:443', '127.0.0.1', 'localhost']) {
    assert.equal(eventsConfigured({ ...f.env, MCP_EVENT_CALLBACK_HOSTS: host }), false, host);
  }
  assert.equal(f.fetches, 0);
});

test('invalid OAuth and ambiguous identity configurations fail closed', async (t) => {
  const f = fixture(t);
  const configs = [
    'invalid', '{}', 'null', '[]', JSON.stringify({ ...f.config, extra: 'unsupported' }),
    JSON.stringify({ ...f.config, resource: 'https://api.example.com/wrong-path' }),
    ...['issuer', 'resource', 'jwksUrl'].flatMap((field) => ['http://auth.example.com', 'https://user:pass@auth.example.com', 'https://127.0.0.1', 'https://localhost', 'https://auth.internal', 'https://auth.example.com/#fragment', 'https://auth.example.com/?query=secret', 'https://auth.example.com:8443'].map((url) => JSON.stringify({ ...f.config, [field]: url }))),
  ];
  for (const config of configs) {
    const env = { ...f.env, MCP_EVENT_AUTH: config };
    assert.equal(eventsConfigured(env), false, config);
    assert.equal((await eventAuthentication(request(jwt()), env)).failure, 'disabled');
  }
  for (const clients of ['invalid', JSON.stringify([client, client]), JSON.stringify([{ ...client, subject: '' }]), JSON.stringify([{ ...client, extra: 'secret' }]), JSON.stringify([{ ...client, principal: '../owner' }]), JSON.stringify([client, { ...client, principal: 'client-b' }]), JSON.stringify([{ principal: 'client-a', tokenSha256: 'a'.repeat(64) }])]) {
    assert.equal(eventsConfigured({ ...f.env, MCP_EVENT_CLIENTS: clients }), false, clients);
  }
  assert.equal(f.fetches, 0);
});

test('metadata and OAuth challenge use the configured resource', (t) => {
  const f = fixture(t);
  assert.deepEqual(eventResourceMetadata(f.env), {
    resource, authorization_servers: [issuer], scopes_supported: ['mcp:events'], bearer_methods_supported: ['header'],
  });
  const challenge = 'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp", scope="mcp:events"';
  assert.equal(eventAuthChallenge(f.env), challenge);
  assert.equal(eventAuthChallenge(f.env, 'invalid_token'), `${challenge}, error="invalid_token"`);
  assert.equal(eventAuthChallenge(f.env, 'insufficient_scope'), `${challenge}, error="insufficient_scope"`);
});

test('verified OAuth subjects produce stable isolated principals across token rotation', async (t) => {
  const f = fixture(t);
  const token = jwt();
  const authenticated = await eventAuthentication(request(token), f.env);
  const expected = `oauth_${createHash('sha256').update(JSON.stringify([issuer, resource, client.subject, client.principal])).digest('hex')}`;
  assert.equal(authenticated.principal, expected);
  assert.equal(authenticated.failure, null);
  assert.equal(authenticated.expiresAt, (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { exp: number }).exp * 1000);
  assert.equal(await authenticateEventPrincipal(request(jwt({ jti: 'rotated-token' })), f.env), expected);
  assert.equal(eventPrincipalAllowed(expected, f.env), true);
  assert.equal(eventPrincipalAllowed(client.principal, f.env), false);
  for (const env of [
    { ...f.env, MCP_EVENT_CLIENTS: '[]' },
    { ...f.env, MCP_EVENT_CLIENTS: JSON.stringify([{ ...client, subject: 'replacement-subject' }]) },
    { ...f.env, MCP_EVENT_CLIENTS: JSON.stringify([{ ...client, principal: 'replacement-alias' }]) },
    { ...f.env, MCP_EVENT_AUTH: JSON.stringify({ ...f.config, issuer: 'https://new.example.com' }) },
    { ...f.env, MCP_EVENT_AUTH: JSON.stringify({ ...f.config, resource: 'https://new.example.com/mcp' }) },
  ]) assert.equal(eventPrincipalAllowed(expected, env), false);
  assert.equal(eventPrincipalAllowed(expected, { ...f.env, MCP_EVENT_AUTH: JSON.stringify({ ...f.config, jwksUrl: `${issuer}/rotated-jwks` }) }), true);
  assert.equal(f.fetches, 1);
});

test('malformed, oversized and non-RS256 credentials are rejected without fetching keys', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await eventAuthentication(request(), f.env), { principal: null, expiresAt: null, failure: 'missing' });
  const tokens = ['not-a-token', 'a.b.c', 'x'.repeat(MCP_EVENT_AUTH_LIMITS.tokenBytes + 1), jwt({}, { alg: 'HS256' }), jwt({}, { alg: 'none' }), jwt({}, { kid: undefined }), jwt({}, { kid: 'a'.repeat(129) })];
  for (const token of tokens) assert.equal((await eventAuthentication(request(token), f.env)).failure, 'invalid_token');
  assert.equal(f.fetches, 0);
});

test('JWT signature and issuer audience subject time claims are validated before authorization', async (t) => {
  const f = fixture(t);
  const now = Math.floor(Date.now() / 1000);
  const invalidClaims = [
    { iss: 'https://attacker.example.com' }, { aud: 'https://elsewhere.example.com/mcp' }, { sub: 'unlisted-user' },
    { exp: now }, { exp: now - 1 }, { exp: undefined }, { exp: 'forever' }, { exp: now + 1.5 }, { exp: Number.MAX_SAFE_INTEGER },
    { iat: now + 1 }, { iat: undefined }, { iat: 'yesterday' }, { iat: -1 },
    { nbf: now + 1 }, { nbf: 'tomorrow' }, { nbf: -1 },
    { aud: undefined }, { iss: undefined }, { sub: undefined },
  ];
  for (const claims of invalidClaims) {
    assert.equal((await eventAuthentication(request(jwt(claims)), f.env)).failure, 'invalid_token', JSON.stringify(claims));
  }
  assert.equal((await eventAuthentication(request(jwt({}, {}, second.privateKey)), f.env)).failure, 'invalid_token');
  assert.equal((await eventAuthentication(request(jwt({ aud: ['another-resource', resource], nbf: now })), f.env)).failure, null);
  assert.equal(f.fetches, 1);
});

test('scope denial requires a valid token and an allowed subject', async (t) => {
  const f = fixture(t);
  for (const scope of [undefined, '', 'read:status', 'prefix-mcp:events', ['mcp:events'], 'mcp:events\tother']) {
    assert.equal((await eventAuthentication(request(jwt({ scope })), f.env)).failure, 'insufficient_scope');
  }
  assert.equal((await eventAuthentication(request(jwt({ scope: 'read:status mcp:events' })), f.env)).failure, null);
  assert.equal((await eventAuthentication(request(jwt({ scope: '', sub: 'unlisted-user' })), f.env)).failure, 'invalid_token');
  assert.equal((await eventAuthentication(request(jwt({ scope: '' }, {}, second.privateKey)), f.env)).failure, 'invalid_token');
});

test('token supplied key URLs and embedded keys never choose the verification key', async (t) => {
  const f = fixture(t);
  const supplied = { jku: 'https://attacker.example.com/keys', x5u: 'https://attacker.example.com/cert', jwk: secondJwk };
  assert.equal((await eventAuthentication(request(jwt({}, supplied)), f.env)).failure, null);
  assert.equal((await eventAuthentication(request(jwt({}, supplied, second.privateKey)), f.env)).failure, 'invalid_token');
  assert.equal(f.fetches, 1);
});

test('unknown kids are throttled and rotation replaces the cached public keys', async (t) => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  let keys = [firstJwk];
  const f = fixture(t, () => Response.json({ keys }));
  assert.equal((await eventAuthentication(request(jwt()), f.env)).failure, null);
  keys = [secondJwk];
  for (let index = 0; index < 10; index++) {
    assert.equal((await eventAuthentication(request(jwt({}, { kid: `missing-${index}` })), f.env)).failure, 'invalid_token');
  }
  assert.equal(f.fetches, 1);
  clock += MCP_EVENT_AUTH_LIMITS.jwksRefreshCooldownMs + 1;
  assert.equal((await eventAuthentication(request(jwt({}, { kid: 'key-b' }, second.privateKey)), f.env)).failure, null);
  assert.equal(f.fetches, 2);
  assert.equal((await eventAuthentication(request(jwt()), f.env)).failure, 'invalid_token');
  assert.equal(f.fetches, 2);
});

test('concurrent authentication coalesces JWKS fetching and failures are throttled', async (t) => {
  let release: (response: Response) => void = () => undefined;
  const f = fixture(t, () => new Promise<Response>((resolve) => { release = resolve; }));
  const attempts = Array.from({ length: 8 }, () => eventAuthentication(request(jwt()), f.env));
  assert.equal(f.fetches, 1);
  release(new Response('Unavailable', { status: 503 }));
  assert.ok((await Promise.all(attempts)).every((result) => result.failure === 'invalid_token'));
  assert.equal((await eventAuthentication(request(jwt()), f.env)).failure, 'invalid_token');
  assert.equal(f.fetches, 1);
});

test('expired JWKS cache cannot authenticate through an upstream outage', async (t) => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  let available = true;
  const f = fixture(t, () => available ? Response.json({ keys: [firstJwk] }) : new Response(null, { status: 503 }));
  assert.equal((await eventAuthentication(request(jwt()), f.env)).failure, null);
  available = false;
  clock += MCP_EVENT_AUTH_LIMITS.jwksCacheMs + 1;
  assert.equal((await eventAuthentication(request(jwt()), f.env)).failure, 'invalid_token');
  assert.equal(f.fetches, 2);
});

test('invalid redirected oversized and private JWKS responses fail closed', async (t) => {
  const replies = [
    () => new Response(null, { status: 302, headers: { Location: 'https://attacker.example.com' } }),
    () => new Response('invalid-json'),
    () => Response.json({ keys: [] }),
    () => Response.json({ keys: [firstJwk, firstJwk] }),
    () => Response.json({ keys: [{ ...firstJwk, d: 'private-key-is-forbidden' }] }),
    () => Response.json({ keys: Array.from({ length: MCP_EVENT_AUTH_LIMITS.jwksKeys + 1 }, () => firstJwk) }),
    () => new Response('x'.repeat(MCP_EVENT_AUTH_LIMITS.jwksBytes + 1)),
    () => Response.json({ keys: [{ ...firstJwk, key_ops: ['encrypt'] }] }),
  ];
  for (const reply of replies) {
    const f = fixture(t, reply);
    assert.equal((await eventAuthentication(request(jwt()), f.env)).failure, 'invalid_token');
    assert.equal(f.fetches, 1);
    f.fetcher.mock.restore();
  }
});

test('JWKS streaming timeout cancels the response and denies authentication', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const f = fixture(t, () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  const authentication = eventAuthentication(request(jwt()), f.env);
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(MCP_EVENT_AUTH_LIMITS.jwksTimeoutMs);
  assert.equal((await authentication).failure, 'invalid_token');
  assert.equal(cancelled, true);
});
