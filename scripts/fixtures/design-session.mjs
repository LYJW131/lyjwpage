import { DurableObject } from 'cloudflare:workers';

import { BuildCoordinator } from '../../workers/ai/src/build/coordinator.ts';
import { openRepository } from '../../workers/ai/src/chat/designer-repository.ts';
import { DesignSession } from '../../workers/ai/src/chat/design-session.ts';
import { issuePass } from '../../workers/ai/src/chat/pass.ts';
import { ChatQuota } from '../../workers/ai/src/chat/quota.ts';
import chatWorker from '../../workers/ai/src/worker.ts';

export { BuildCoordinator, ChatQuota };

const repo = 'LYJW131/lyjwpage';
const SHA = 'a'.repeat(40);
const MODEL = 'claude-opus-5-5';
const FILES = {
  'README.md': '# fixture site\nThe planner reads this needle file.\n',
  'src/a.ts': 'export const fixture = 1;\n',
  'src/components/fixture.tsx': 'export function FixtureCard() { return null; }\n',
};

const treeEntries = Object.keys(FILES).map((path, index) => ({ path, type: 'blob', mode: '100644', sha: `${index.toString(16).padStart(2, '0')}${'b'.repeat(38)}` }));

const json = (value, status = 200) => Response.json(value, { status });

// 仓库快照走 GitHub 公开接口：fixture 应答固定 SHA 的 ref、tree 与 raw 文件，模型拿不到别的网络。
const githubFetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === 'api.github.com') {
    if (url.pathname === `/repos/${repo}/git/ref/heads/main`) return json({ object: { sha: SHA } });
    if (url.pathname === `/repos/${repo}/git/trees/${SHA}`) return json({ truncated: false, tree: treeEntries });
    return new Response('not found', { status: 404 });
  }
  if (url.hostname === 'raw.githubusercontent.com') {
    const path = decodeURIComponent(url.pathname.slice(`/${repo}/${SHA}/`.length));
    return FILES[path] !== undefined ? new Response(FILES[path]) : new Response('not found', { status: 404 });
  }
  return new Response('blocked', { status: 400 });
};

export class FixtureDesignSession extends DesignSession {
  repository() {
    this.repo ??= openRepository({ env: this.env, fetcher: githubFetch, store: this.records }).then((opened) => {
      this.repoSha = opened.sha;
      return opened;
    });
    return this.repo;
  }

  readStatus() {
    return Promise.resolve(json({ ok: true, data: { fixture: true } }));
  }

  // fixture 直写记录：模拟“持久化 submitted 之后、pi 入队之前”崩溃的缝。
  putRecord(key, value) {
    this.records.put(key, JSON.stringify(value));
    return true;
  }

  getRecord(key) {
    try {
      const raw = this.records.get(key);
      return raw === undefined ? undefined : JSON.parse(raw);
    } catch {
      // deleteAll 之后表都不在了：读不到就当没有记录。
      return undefined;
    }
  }

  deleteRecord(key) {
    this.records.delete(key);
    return true;
  }

  async lastEntryId() {
    await this.lifecycle.start();
    const messages = await this.session().messages();
    return messages.reduce((max, entry) => Math.max(max, entry.id), 0);
  }

  async dumpEntries() {
    await this.lifecycle.start();
    const messages = await this.session().messages();
    return messages.map((entry) => ({ id: entry.id, type: entry.constructor?.name, modelType: Array.isArray(entry.model) ? 'array' : typeof entry.model, model: JSON.stringify(entry.model)?.slice(0, 1200) }));
  }

  async pendingOps() {
    await this.lifecycle.start();
    return this.harness.pending({ session: '1' });
  }

  dumpRecords() {
    return this.ctx.storage.sql.exec('SELECT key, value FROM designer_records ORDER BY key').toArray()
      .map((row) => ({ key: row.key, value: String(row.value).slice(0, 400) }));
  }

  // 一次性的析构失败注入：同实例重试必须从头再跑并真正删干净。
  async disposeSession() {
    if (this.records.get('dispose-fail') !== undefined) {
      this.records.delete('dispose-fail');
      throw new Error('fixture dispose failure');
    }
    return super.disposeSession();
  }
}

const QUESTIONS = [{ header: 'Scope', question: 'How much should the card show?', multiSelect: false, options: [{ label: 'Summary', description: 'Simplest' }, { label: 'Showcase', description: 'More work' }] }];
const PLAN = { title: 'Improve the fixture card', spec: 'Render the fixture card clearly at all widths.', acceptance: ['The card reads correctly at 375px.'], paths: ['src/components/fixture.tsx'] };

// Anthropic 的 SSE 实际是 CRLF 分帧：夹具照实发，消费端按 \r?\n 解析。
const sse = (events) => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('').replaceAll('\n', '\r\n');

const messageStart = ['message_start', { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: MODEL, content: [], stop_reason: null, usage: { input_tokens: 64, output_tokens: 1 } } }];
const messageStop = ['message_stop', { type: 'message_stop' }];

// 剧本只看最后一条消息：工具结果续一句正文；访客消息含 ask/plan/read/hold 关键词走对应分支，其余回一段正文。
// Sonnet 那一步总是立刻移交设计会话，浏览器验收经生产 handleChat 走完整条链路。
// 每个上游调用记进 egress 的 fixture_calls 表，测试据此核对有没有额外的付费请求。
function script(lastUserText, toolResult, model) {
  const text = (content) => [
    messageStart,
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ];
  const tool = (index, name, input) => [
    ['content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_${name}`, name, input: {} } }],
    ['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(0, 40) } }],
    ['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(40) } }],
    ['content_block_stop', { type: 'content_block_stop', index }],
  ];
  const done = (stop, outputTokens = 48) => [
    ['message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: outputTokens } }],
    messageStop,
  ];
  if (model !== MODEL) return [...text('Opening a design session for that.'), ...tool(1, 'start_design', {}), ...done('tool_use')];
  if (toolResult) return [...text('I read the file.'), ...done('end_turn')];
  if (lastUserText.includes('ask me')) return [...text('One question first.'), ...tool(1, 'ask_visitor', { questions: QUESTIONS }), ...done('tool_use')];
  // 选项卡的答复把题目原文拼进文本：命中题目就当成「按计划走」。
  if (lastUserText.includes('make a plan') || lastUserText.includes('should the card show')) return [...text('Here is the plan.'), ...tool(1, 'propose_build', PLAN), ...done('tool_use')];
  if (lastUserText.includes('read the repo')) return [...text('Looking.'), ...tool(1, 'read', { path: 'README.md' }), ...done('tool_use', 30)];
  return [...text(`Fixture answer to: ${lastUserText.slice(0, 60)}`), ...done('end_turn')];
}

export class AnthropicEgress extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_calls (url TEXT NOT NULL, at INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('INSERT INTO fixture_calls VALUES (?, ?)', `${url.pathname}`, Date.now());
    if (url.pathname === '/v1/messages/count_tokens') return json({ input_tokens: 64 });
    if (url.pathname !== '/v1/messages' || request.method !== 'POST') return new Response('not found', { status: 404 });
    const body = await request.json().catch(() => null);
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const last = messages.at(-1);
    const toolResult = Array.isArray(last?.content) && last.content.some((block) => block?.type === 'tool_result' || block?.type === 'tool-call-result');
    const lastUser = [...messages].reverse().find((entry) => entry.role === 'user');
    const text = (Array.isArray(lastUser?.content) ? lastUser.content.map((block) => block?.text ?? '').join('') : lastUser?.content) ?? '';
    const frames = script(text, toolResult, body?.model);
    if (text.includes('slowly')) {
      // 刻意拖慢的 SSE：两个写入之间隔一段真实时间，覆盖迟到补放的流路径。
      const payload = sse(frames);
      const encoder = new TextEncoder();
      const delayed = new ReadableStream({
        async start(controller) {
          const half = payload.length >> 1;
          controller.enqueue(encoder.encode(payload.slice(0, half)));
          await new Promise((resolve) => setTimeout(resolve, 250));
          controller.enqueue(encoder.encode(payload.slice(half)));
          controller.close();
        },
      });
      return new Response(delayed, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (text.includes('hold')) {
      const encoder = new TextEncoder();
      const head = sse(frames);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(head.slice(0, head.length / 2)));
        },
        cancel() { this.cancelled = true; },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response(sse(frames), { headers: { 'Content-Type': 'text/event-stream' } });
  }

  calls() {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS fixture_calls (url TEXT NOT NULL, at INTEGER NOT NULL)');
    return this.ctx.storage.sql.exec('SELECT url FROM fixture_calls').toArray().map((row) => row.url);
  }

  reset() {
    this.ctx.storage.sql.exec('DROP TABLE IF EXISTS fixture_calls');
    return true;
  }
}

const methods = new Set(['initialize', 'prepareTurn', 'matches', 'cancel', 'putRecord', 'getRecord', 'deleteRecord', 'lastEntryId', 'dumpEntries', 'dumpRecords', 'pendingOps', 'disposeSession']);
const coordinatorMethods = new Set(['createDesign', 'admitDesign', 'peekDesign', 'hasDesignAdmission', 'expiredDesignSessions', 'forgetDesignSession']);

const fixtureWorker = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/api/chat' || url.pathname === '/api/chat/usage' || request.method === 'OPTIONS') return chatWorker.fetch(request, env);
      if (url.pathname === '/__fixture/ready') return json({ ready: true });
      // 只服务本夹具：给浏览器会话签发与来访 IP 匹配的人机通行证，绕开真实 Turnstile。
      if (url.pathname === '/__fixture/pass') return json(await issuePass(env.CHAT_HISTORY_SECRET, request.headers.get('CF-Connecting-IP') ?? 'unknown'));
      const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
      if (url.pathname === '/__fixture/egress') {
        const egress = env.ANTHROPIC_EGRESS.get(env.ANTHROPIC_EGRESS.idFromName('anthropic-wnam'));
        return json(await egress[body.method === 'reset' ? 'reset' : 'calls']());
      }
      if (url.pathname === '/__fixture/coordinator') {
        const { method, args } = body;
        if (!coordinatorMethods.has(method)) return json({ error: 'unknown method' }, 400);
        return json(await env.BUILD_COORDINATOR.getByName('global')[method](...args));
      }
      if (url.pathname === '/__fixture/session') {
        const { id, method, args } = body;
        if (!methods.has(method)) return json({ error: 'unknown method' }, 400);
        try {
          const out = await env.DESIGN_SESSIONS.getByName(id)[method](...args);
          return json(out === undefined ? true : out);
        } catch (error) {
          return json({ error: String(error?.message ?? error) }, 500);
        }
      }
      if (url.pathname === '/__fixture/stream') {
        const { id, input } = body;
        return env.DESIGN_SESSIONS.getByName(id).fetch(new Request('https://design-session.internal/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: request.signal,
        }));
      }
      return json({ error: 'Unknown fixture route' }, 404);
    } catch (error) {
      return json({ error: String(error?.message ?? error) }, 500);
    }
  },
};

export default fixtureWorker;
