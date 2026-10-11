#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'workers/ai/package.json'));
const temporary = await mkdtemp(join(tmpdir(), 'lyjw-design-verify-'));
const children = [];
const logs = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function eventually(check, ms = 45_000) {
  const deadline = Date.now() + ms;
  let failure;
  do {
    try { return await check(); } catch (error) { failure = error; }
    await sleep(100);
  } while (Date.now() < deadline);
  throw failure;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = once(child, 'exit');
  // wrangler 以 detached 起在独立进程组：整组 SIGKILL，workerd 子进程不会漏成孤儿。
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  await Promise.race([exited, sleep(5000)]);
}

try {
  const port = await availablePort();
  const worker = `http://127.0.0.1:${port}`;
  const configPath = join(temporary, 'wrangler.json');
  // 与 verify-build-worker 同款隔离：临时目录里写配置，持久状态只在 --persist-to 下，不碰生产绑定。
  await writeFile(configPath, JSON.stringify({
    name: 'isolated-design-verification', main: join(root, 'scripts/fixtures/design-session.mjs'),
    compatibility_date: '2026-10-09', compatibility_flags: ['nodejs_compat', 'nodejs_compat_populate_process_env', 'enable_request_signal'],
    vars: {
      ANTHROPIC_API_KEY: 'fixture-anthropic-key', BUILD_SESSION_SECRET: 'local-design-fixture-only',
      CHAT_HISTORY_SECRET: 'local-chat-fixture-only', TURNSTILE_SECRET_KEY: 'fixture-turnstile-key',
      AI_DEV: 'true', CHAT_FORCE_TIER: 'design',
    },
    durable_objects: { bindings: [
      { name: 'DESIGN_SESSIONS', class_name: 'FixtureDesignSession' },
      { name: 'BUILD_COORDINATOR', class_name: 'BuildCoordinator' },
      { name: 'ANTHROPIC_EGRESS', class_name: 'AnthropicEgress' },
      { name: 'CHAT_QUOTA', class_name: 'ChatQuota' },
    ] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['FixtureDesignSession', 'BuildCoordinator', 'AnthropicEgress', 'ChatQuota'] }],
  }));
  const start = () => {
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SystemRoot', 'MINIFLARE_WORKERD_PATH'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    const child = spawn(process.execPath, [require.resolve('wrangler'), 'dev', '-c', configPath, '--port', String(port), '--ip', '127.0.0.1', '--inspector-port', '0', '--persist-to', join(temporary, 'state')], {
      cwd: temporary, detached: true, env: { ...env, CI: 'true', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(temporary, 'wrangler.log') }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => logs.push(chunk.toString()));
    return child;
  };
  let child = start();
  const ready = () => eventually(async () => assert.equal((await fetch(`${worker}/__fixture/ready`, { signal: AbortSignal.timeout(1000) })).status, 200));
  await ready();
  const post = (path, body) => fetch(`${worker}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const jsonCall = async (tag, path, body) => {
    const response = await post(path, body);
    const text = await response.text();
    try { return JSON.parse(text); } catch { throw new Error(`${tag}: ${response.status} ${text.slice(0, 160)}`); }
  };
  const coordinator = (method, ...args) => jsonCall(`coordinator.${method}`, '/__fixture/coordinator', { method, args });
  const session = (id, method, ...args) => jsonCall(`session.${method}`, '/__fixture/session', { id, method, args });
  const egressCalls = async () => jsonCall('egress.calls', '/__fixture/egress', { method: 'calls' });
  const stream = (id, input) => post('/__fixture/stream', { id, input });
  const framesOf = async (response) => (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const restart = async () => { await stop(child); child = start(); await ready(); };

  const designId = crypto.randomUUID();
  const expiresAt = Date.now() + 25 * 60_000;
  assert.equal(await coordinator('createDesign', designId, expiresAt), true);
  await session(designId, 'initialize', designId, expiresAt);
  const repoRecord = await session(designId, 'getRecord', 'repo');
  assert.ok(repoRecord?.sha && Object.keys(repoRecord.files ?? {}).length >= 3);
  console.log('PASS: initialize persists the fixed repository snapshot before any model call');

  // 第 1 回合：规划者问一个问题并挂起，待答卡片落进 durable 状态。
  const req1 = 'aa'.repeat(32);
  const latest1 = 'Please ask me what the card should show.';
  assert.equal((await coordinator('admitDesign', designId, req1)).status, 'ok');
  assert.equal((await session(designId, 'prepareTurn', req1, latest1, { kind: 'open', history: [{ role: 'user', content: latest1 }] })).status, 'prepared');
  const first = await framesOf(await stream(designId, { kind: 'resume', requestId: req1, latest: latest1 }));
  assert.equal(first.filter((frame) => frame.type === 'event' && frame.event.type === 'ask').length, 1);
  const textOf = (frames) => frames.filter((frame) => frame.type === 'event' && frame.event.type === 'text').map((frame) => frame.event.text).join('');
  assert.equal(textOf(first), 'One question first.');
  const result1 = first.find((frame) => frame.type === 'result')?.result;
  assert.equal(result1?.complete, true);
  assert.equal(result1?.asked, true);
  assert.equal((await session(designId, 'getRecord', 'pending'))?.event?.type, 'ask');
  const messagesCalls1 = (await egressCalls()).filter((url) => url === '/v1/messages').length;
  assert.ok(messagesCalls1 >= 1);
  console.log('PASS: first turn asks the visitor and persists the pending question card');

  // 进程被杀再拉起：pending 卡片与 pi 状态都从同一 persist 目录回来。
  await restart();
  const replayAsk = await framesOf(await stream(designId, { kind: 'resume', requestId: req1, latest: latest1 }));
  assert.equal(replayAsk.filter((frame) => frame.type === 'event' && frame.event.type === 'ask').length, 1);
  assert.equal(textOf(replayAsk), 'One question first.');
  assert.equal(replayAsk.find((frame) => frame.type === 'result')?.result?.asked, true);
  console.log('PASS: workerd restart replays the pending question card and sealed result');

  // 第 2 回合：答复 pending 问题，规划者给出计划并挂起。
  const req2 = 'bb'.repeat(32);
  const latest2 = 'Summary please — make a plan for the card.';
  assert.equal((await coordinator('admitDesign', designId, req2)).status, 'ok');
  assert.equal((await session(designId, 'prepareTurn', req2, latest2, { kind: 'reply', text: latest2 })).status, 'prepared');
  const second = await framesOf(await stream(designId, { kind: 'resume', requestId: req2, latest: latest2 }));
  assert.equal(textOf(second), 'Here is the plan.');
  const planEvent = second.find((frame) => frame.type === 'event' && frame.event.type === 'plan')?.event;
  assert.ok(planEvent?.token);
  const result2 = second.find((frame) => frame.type === 'result')?.result;
  assert.equal(result2?.complete, true);
  assert.equal(result2?.planToken, planEvent.token);
  console.log('PASS: visitor reply produces a signed plan card and sealed planToken result');

  // 再重启：resume 同一回合重放出同一份已签发 token，不会二次签名。
  await restart();
  const replayPlan = await framesOf(await stream(designId, { kind: 'resume', requestId: req2, latest: latest2 }));
  assert.equal(replayPlan.find((frame) => frame.type === 'event' && frame.event.type === 'plan')?.event?.token, planEvent.token);
  assert.equal(textOf(replayPlan), 'Here is the plan.');
  assert.equal(replayPlan.find((frame) => frame.type === 'result')?.result?.planToken, planEvent.token);
  console.log('PASS: restart replay returns the same signed plan token without re-issuing');

  // 持久化 submitted 与 pi 入队之间的崩溃缝：直接写记录、重启、resume，同一 operationId 补投。
  const req3 = 'cc'.repeat(32);
  const latest3 = 'crash gap recovery check';
  assert.equal((await coordinator('admitDesign', designId, req3)).status, 'ok');
  const cutoff = await session(designId, 'lastEntryId');
  const book = await session(designId, 'getRecord', 'turns');
  book.turns[req3] = { requestId: req3, latest: latest3, state: 'submitted', preparedAt: Date.now(), input: 'crash gap recovery check', cutoff, views: [], reads: [] };
  book.current = req3;
  await session(designId, 'putRecord', 'turns', book);
  // 真实的 prepared→submitted 事务会原子清掉挂起的交互；缝里的崩溃发生在事务之后，pending 已不在。
  await session(designId, 'deleteRecord', 'pending');
  await restart();
  const recovered = await framesOf(await stream(designId, { kind: 'resume', requestId: req3, latest: latest3 }));
  const result3 = recovered.find((frame) => frame.type === 'result')?.result;
  assert.equal(result3?.complete, true);
  assert.match(recovered.filter((frame) => frame.type === 'event' && frame.event.type === 'text').map((frame) => frame.event.text).join(''), /Fixture answer/);
  assert.equal((await session(designId, 'getRecord', 'turns')).turns[req3].state, 'finished');
  console.log('PASS: a crash between persisting submitted and pi enqueue resubmits by operationId after restart');

  // 配额被拒留下的未受理草稿：连 resume:true 也不能换得一次付费模型调用。
  const req4 = 'dd'.repeat(32);
  const latest4 = 'unadmitted sneaky retry';
  assert.equal((await session(designId, 'prepareTurn', req4, latest4, { kind: 'reply', text: latest4 })).status, 'prepared');
  assert.equal(await coordinator('hasDesignAdmission', designId, req4), false);
  const callsBefore = (await egressCalls()).filter((url) => url === '/v1/messages').length;
  const denied = await stream(designId, { kind: 'resume', requestId: req4, latest: latest4 });
  assert.equal(denied.status, 409);
  await denied.text();
  assert.equal((await egressCalls()).filter((url) => url === '/v1/messages').length, callsBefore);
  assert.equal(await session(designId, 'matches', req4, latest4), false);
  console.log('PASS: a prepared turn without coordinator admission can never reach the model');

  // 未受理草稿 60 秒内挡新回合；把它写旧再继续，等价于真实流程里等它失效。
  const book5 = await session(designId, 'getRecord', 'turns');
  book5.turns[req4].preparedAt = Date.now() - 61_000;
  await session(designId, 'putRecord', 'turns', book5);

  // 显式取消：挂起的模型调用被掐断，回合落终态 cancelled，迟到完成不得改写。
  const req5 = 'ee'.repeat(32);
  const latest5 = 'hold this thought';
  assert.equal((await coordinator('admitDesign', designId, req5)).status, 'ok');
  assert.equal((await session(designId, 'prepareTurn', req5, latest5, { kind: 'reply', text: latest5 })).status, 'prepared');
  const held = await stream(designId, { kind: 'resume', requestId: req5, latest: latest5 });
  assert.equal(held.status, 200);
  await eventually(async () => assert.ok((await egressCalls()).filter((url) => url === '/v1/messages').length > callsBefore));

  // pi 还挂着时：同一 requestId 挂回而不是报忙，新请求被拒，老终态只读不回放 pi；协调器账上一笔没动。
  const roster = JSON.stringify(await coordinator('peekDesign', designId));
  assert.equal((await session(designId, 'prepareTurn', req5, latest5, { kind: 'reply', text: latest5 })).status, 'attached');
  assert.equal((await session(designId, 'prepareTurn', 'ab'.repeat(32), 'another message while held', { kind: 'reply', text: 'x' })).status, 'busy');
  assert.equal((await session(designId, 'prepareTurn', req1, latest1, { kind: 'open', history: [{ role: 'user', content: latest1 }] })).status, 'finished');
  assert.equal(JSON.stringify(await coordinator('peekDesign', designId)), roster);
  // 老回合的重放只倒自己的归档段：挂着的新回合正文一个字都不许漏进来。
  const oldReplay = await framesOf(await stream(designId, { kind: 'resume', requestId: req1, latest: latest1 }));
  assert.equal(oldReplay.filter((frame) => frame.type === 'event' && frame.event.type === 'ask').length, 1);
  assert.equal(textOf(oldReplay), 'One question first.');
  assert.equal(oldReplay.find((frame) => frame.type === 'result')?.result?.asked, true);
  console.log('PASS: held turn attaches the same request, rejects new ones, and old replay stays inside its archive window');

  await session(designId, 'cancel', req5);
  await held.text().catch(() => {});
  const bookAfterCancel = await session(designId, 'getRecord', 'turns');
  assert.equal(bookAfterCancel.turns[req5].state, 'cancelled');
  console.log('PASS: explicit Stop cancels the in-flight model call and seals the turn cancelled');

  await restart();
  const stillCancelled = (await session(designId, 'getRecord', 'turns')).turns[req5];
  assert.equal(stillCancelled.state, 'cancelled');
  const cancelledReplay = await stream(designId, { kind: 'resume', requestId: req5, latest: latest5 });
  assert.equal(cancelledReplay.status, 409);
  await cancelledReplay.text();
  console.log('PASS: cancelled stays terminal across restart and rejects late resume');

  // 下一个正常回合不受 cancelled 回合影响，仍能在重启后完成。
  const req6 = 'ff'.repeat(32);
  const latest6 = 'final check please';
  assert.equal((await coordinator('admitDesign', designId, req6)).status, 'ok');
  assert.equal((await session(designId, 'prepareTurn', req6, latest6, { kind: 'reply', text: latest6 })).status, 'prepared');
  const sixth = await framesOf(await stream(designId, { kind: 'resume', requestId: req6, latest: latest6 }));
  assert.equal(sixth.find((frame) => frame.type === 'result')?.result?.complete, true);
  assert.equal(textOf(sixth), 'Fixture answer to: final check please');
  console.log('PASS: a new turn proceeds normally after a cancelled turn');

  // 同一 requestId 的两条并发流：赢家提交、输家按持久记录挂回；'slowly' 上游把 SSE 拆成两段迟到补放，两侧文本逐字一致不重复。
  const req7 = '12'.repeat(32);
  const latest7 = 'reply slowly please';
  assert.equal((await coordinator('admitDesign', designId, req7)).status, 'ok');
  assert.equal((await session(designId, 'prepareTurn', req7, latest7, { kind: 'reply', text: latest7 })).status, 'prepared');
  const raceA = await stream(designId, { kind: 'resume', requestId: req7, latest: latest7 });
  assert.equal(raceA.status, 200);
  // 等赢家把 submitted 落盘再发第二条：输家稳定走挂回路径，此时拖慢的上游还在流，两条观察泵重叠。
  await eventually(async () => assert.equal((await session(designId, 'getRecord', 'turns')).turns[req7]?.state, 'submitted'));
  const raceB = await stream(designId, { kind: 'resume', requestId: req7, latest: latest7 });
  assert.equal(raceB.status, 200);
  const parse = (body) => body.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const [framesA, framesB] = await Promise.all([raceA.text(), raceB.text()]).then(([a, b]) => [parse(a), parse(b)]);
  assert.equal(framesA.find((frame) => frame.type === 'result')?.result?.complete, true, `A: ${framesA.slice(0, 800)}`);
  assert.equal(framesB.find((frame) => frame.type === 'result')?.result?.complete, true, `B: ${framesB.slice(0, 800)}`);
  assert.equal(textOf(framesA), 'Fixture answer to: reply slowly please', `A: ${framesA.slice(0, 800)}`);
  assert.equal(textOf(framesB), 'Fixture answer to: reply slowly please', `B: ${framesB.slice(0, 800)}`);
  console.log('PASS: concurrent streams on one request attach the loser, delayed SSE yields identical text on both');

  // 析构失败可重试：注入一次性失败，同实例第二次跑完 deleteAll，回合记录与待答全部清空。
  await session(designId, 'putRecord', 'dispose-fail', true);
  const dispose1 = await (await post('/__fixture/session', { id: designId, method: 'disposeSession', args: [] })).json();
  assert.match(String(dispose1.error ?? ''), /dispose failure/);
  const dispose2 = await (await post('/__fixture/session', { id: designId, method: 'disposeSession', args: [] })).json();
  // deleteAll 可能掐断在途 RPC 的响应通道；成不成功由随后的记录查询裁定，这里只断言没有业务错误。
  assert.ok(dispose2 === true || /Network connection lost/i.test(String(dispose2.error ?? '')), JSON.stringify(dispose2));
  // 存储删空后 getRecord 拿不到任何键，序列化回落成 true。
  assert.equal(await session(designId, 'getRecord', 'turns'), true);
  assert.equal(await session(designId, 'getRecord', 'pending'), true);
  assert.equal(await session(designId, 'matches', req7, latest7), false);
  console.log('PASS: disposal failure is retryable on the same instance and leaves no records behind');

  assert.equal(logs.some((line) => /Cannot perform I\/O|Uncaught|SQLITE_ERROR|Internal error/.test(line)), false, 'No workerd isolation or SQLite errors');
} catch (error) {
  await writeFile('/tmp/lyjw-design-verify.log', stripVTControlCharacters(logs.join(''))).catch(() => {});
  const diagnostic = stripVTControlCharacters(logs.join('')).split('\n').filter((line) => /error|Error|failed|Failed|ready on|pump|exception|Exception|fatal|crash/i.test(line)).slice(-40).join('\n');
  console.error(diagnostic.replace(/eyJ[A-Za-z0-9_.-]+/g, '[token]'));
  throw error;
} finally {
  await Promise.all(children.map(stop));
  await rm(temporary, { recursive: true, force: true });
}
