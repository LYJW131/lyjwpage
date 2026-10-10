import assert from "node:assert/strict";
import test from "node:test";
import {
  createSseParser,
  defuseMentions,
  describeActivity,
  extractTodos,
  HttpError,
  normalizeTodoStatus,
  parseCommand,
  parseModel,
  renderComment,
  runCursorAgent,
} from "./cursor-agent.mjs";

const REPO = "LYJW131/lyjwpage";

const todoWrite = (status, args, result) => ({
  event: "tool_call",
  data: { callId: "call-1", name: "todo_write", status, args, ...(result ? { result } : {}) },
});

test("只认行首的 /cursor 指令", () => {
  assert.deepEqual(parseCommand("/cursor 把标题改成英文\n顺便补测试"), { request: "把标题改成英文\n顺便补测试" });
  assert.deepEqual(parseCommand("  /cursor"), { request: "" });
  assert.equal(parseCommand("/cursorx do it"), null);
  assert.equal(parseCommand("please /cursor do it"), null);
  assert.equal(parseCommand("@cursor do it"), null);
});

test("模型配置拆成 id 与参数", () => {
  assert.deepEqual(parseModel("grok-4.7 reasoning_effort=xhigh fast=true"), {
    id: "grok-4.7",
    params: [{ id: "reasoning_effort", value: "xhigh" }, { id: "fast", value: "true" }],
  });
  assert.deepEqual(parseModel("composer-2.5"), { id: "composer-2.5" });
  assert.throws(() => parseModel("grok-4.7 fast"), /key=value/);
  assert.throws(() => parseModel(" "), /为空/);
});

test("SSE 解析跨分片、CRLF 与 id", () => {
  const events = [];
  const push = createSseParser((event) => events.push(event));
  push('event: status\r\ndata: {"status":"RUN');
  push('NING"}\r\n\r\nid: 17-0\nevent: assistant\ndata: {"text":"hi"}\n\n: keepalive\n\n');
  assert.deepEqual(events, [
    { id: undefined, event: "status", data: { status: "RUNNING" } },
    { id: "17-0", event: "assistant", data: { text: "hi" } },
  ]);
});

test("待办只取完成事件里合并后的完整列表", () => {
  const delta = [{ id: "2", content: "read AGENTS.md", status: "TODO_STATUS_IN_PROGRESS" }];
  assert.equal(extractTodos(todoWrite("running", { todos: delta })), null);
  assert.equal(extractTodos(todoWrite("running", { todos: delta, merge: true })), null);
  assert.equal(
    extractTodos({ event: "interaction_update", data: { type: "tool-call-started", toolCall: { type: "updateTodos", args: { todos: [{ content: "x", status: "inProgress" }] } } } }),
    null,
  );

  const merged = [
    { id: "1", content: "read README.md", status: "TODO_STATUS_COMPLETED" },
    { id: "2", content: "read AGENTS.md", status: "TODO_STATUS_IN_PROGRESS" },
    { id: "3", content: "summarize", status: "TODO_STATUS_PENDING" },
  ];
  const expected = [
    { content: "read README.md", status: "completed" },
    { content: "read AGENTS.md", status: "inProgress" },
    { content: "summarize", status: "pending" },
  ];
  assert.deepEqual(extractTodos(todoWrite("completed", { todos: delta, merge: true }, { success: { todos: merged } })), expected);
  assert.deepEqual(
    extractTodos({
      event: "interaction_update",
      data: { type: "tool-call-completed", toolCall: { type: "updateTodos", args: { todos: [] }, result: { status: "success", value: { todos: expected, totalCount: 3 } } } },
    }),
    expected,
  );
  assert.equal(extractTodos({ event: "tool_call", data: { name: "get_mcp_tools", status: "completed", args: { toolName: "TodoWrite" }, result: { success: { content: "{}" } } } }), null);
});

test("待办状态兼容各种写法", () => {
  assert.equal(normalizeTodoStatus("TODO_STATUS_IN_PROGRESS"), "inProgress");
  assert.equal(normalizeTodoStatus("in_progress"), "inProgress");
  assert.equal(normalizeTodoStatus("canceled"), "cancelled");
  assert.equal(normalizeTodoStatus(undefined), "pending");
});

test("当前动作取自 started 事件", () => {
  const started = (type, args) => ({ event: "interaction_update", data: { type: "tool-call-started", toolCall: { type, args } } });
  assert.equal(describeActivity(started("read", { path: "/workspace/README.md" })), "Reading `README.md`");
  assert.equal(describeActivity(started("shell", { command: "pnpm  test\n--watch=false" })), "Running `pnpm test --watch=false`");
  assert.equal(describeActivity(started("edit", { path: "/workspace/src/a.ts" })), "Editing `src/a.ts`");
  assert.equal(describeActivity(started("updateTodos", { todos: [] })), null);
  assert.equal(describeActivity({ event: "tool_call", data: { name: "run_terminal_cmd", status: "running", args: { command: "pnpm te" } } }), null);
});

test("评论渲染待办、提交并断开 @ 提及", () => {
  const body = renderComment({
    status: "FINISHED",
    request: "ping @someone",
    todos: [
      { content: "plan", status: "completed" },
      { content: "edit", status: "inProgress" },
      { content: "drop", status: "cancelled" },
      { content: "later", status: "pending" },
    ],
    durationMs: 125_000,
    branch: "feat/x",
    commits: [{ sha: "0123456789abcdef", message: "fix(ui): 修好 @foo 的按钮\n\nbody" }],
    summary: "done @bar",
    agentUrl: "https://cursor.com/agents/bc-1",
    model: "grok-4.7",
  });
  assert.match(body, /✅ Finished · 2m 5s/);
  assert.match(body, /- \[x\] plan\n- \[ \] \*\*edit\*\* ⏳\n- \[ \] ~~drop~~\n- \[ \] later/);
  assert.match(body, /\*\*Todo\*\* \(1\/4\)/);
  assert.match(body, /Pushed 1 commit to `feat\/x`/);
  assert.match(body, /- 0123456 fix\(ui\): 修好 @​foo 的按钮/);
  assert.ok(!/@(?!​)[a-z]/.test(body));
  assert.equal(defuseMentions("a@b.com @x"), "a@​b.com @​x");
});

function fakeGithub({ pull, headAfter, compare = [] } = {}) {
  const calls = { comments: [], updates: [], reactions: [] };
  let pulls = 0;
  const basePull = {
    number: 7,
    state: "open",
    title: "feat: something",
    body: "desc",
    html_url: `https://github.com/${REPO}/pull/7`,
    head: { ref: "feat/x", sha: "aaa", repo: { full_name: REPO } },
    base: { ref: "main" },
    ...pull,
  };
  return {
    calls,
    react: async (comment, content) => calls.reactions.push({ comment, content }),
    createComment: async (target, body) => {
      calls.comments.push({ target, body });
      return { id: 99 };
    },
    updateComment: async (target, id, body) => calls.updates.push({ target, id, body }),
    getPull: async () => {
      pulls += 1;
      return pulls === 1 ? basePull : { ...basePull, head: { ...basePull.head, sha: headAfter ?? basePull.head.sha } };
    },
    compare: async () => ({ commits: compare.map(([sha, message]) => ({ sha, commit: { message } })) }),
  };
}

function fakeCursor(streams, finalRun = { status: "FINISHED", result: "改好了", durationMs: 1000 }) {
  const calls = { create: [], streams: [], cancel: 0 };
  return {
    calls,
    createAgent: async (body) => {
      calls.create.push(body);
      return { agent: { id: "bc-1", url: "https://cursor.com/agents/bc-1" }, run: { id: "run-1", status: "CREATING" } };
    },
    getRun: async () => finalRun,
    cancelRun: async () => {
      calls.cancel += 1;
    },
    async *streamRun(agentId, runId, options) {
      calls.streams.push(options.lastEventId);
      const next = streams.shift();
      if (next instanceof Error) throw next;
      for (const item of next ?? []) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (item instanceof Error) throw item;
        yield item;
      }
    },
  };
}

const issuePayload = (body = "/cursor 把按钮改成蓝色") => ({
  issue: { number: 7, pull_request: {} },
  comment: { id: 5, body, user: { login: "lyjw131" }, html_url: `https://github.com/${REPO}/pull/7#issuecomment-5` },
});

const quiet = { log() {}, warn() {} };
const noSleep = async () => {};

test("完整流程：在 PR 分支上起 agent，评论跟随待办并列出推送", async () => {
  const github = fakeGithub({ headAfter: "bbb", compare: [["bbbbbbbbbb", "fix(ui): 按钮改成蓝色"]] });
  const cursor = fakeCursor([
    [
      { event: "status", data: { status: "RUNNING" } },
      { id: "1-0", ...todoWrite("completed", {}, { success: { todos: [{ content: "改按钮", status: "TODO_STATUS_IN_PROGRESS" }, { content: "跑测试", status: "TODO_STATUS_PENDING" }] } }) },
      { id: "2-0", event: "result", data: { status: "FINISHED", text: "改好了" } },
    ],
  ]);
  const code = await runCursorAgent({ eventName: "issue_comment", payload: issuePayload(), repo: REPO, github, cursor, log: quiet, sleep: noSleep, commentIntervalMs: 0 });

  assert.equal(code, 0);
  assert.deepEqual(github.calls.reactions, [{ comment: { kind: "issue", id: 5 }, content: "eyes" }]);
  const [create] = cursor.calls.create;
  assert.deepEqual(create.repos, [{ url: `https://github.com/${REPO}`, prUrl: `https://github.com/${REPO}/pull/7` }]);
  assert.equal(create.workOnCurrentBranch, true);
  assert.equal(create.autoCreatePR, false);
  assert.deepEqual(create.model, { id: "grok-4.7", params: [{ id: "reasoning_effort", value: "xhigh" }, { id: "fast", value: "true" }] });
  assert.match(create.prompt.text, /把按钮改成蓝色/);
  assert.match(create.prompt.text, /`feat\/x` into `main`/);

  assert.ok(github.calls.updates.some((update) => /\*\*改按钮\*\* ⏳/.test(update.body)));
  const final = github.calls.updates.at(-1).body;
  assert.match(final, /✅ Finished/);
  assert.match(final, /- \[x\] 改按钮\n- \[ \] 跑测试/);
  assert.match(final, /Pushed 1 commit to `feat\/x`[\s\S]*bbbbbbb fix\(ui\): 按钮改成蓝色/);
  assert.match(final, /改好了/);
});

test("流中断后带 Last-Event-ID 续上", async () => {
  const github = fakeGithub();
  const cursor = fakeCursor([
    [{ id: "1-0", event: "status", data: { status: "RUNNING" } }, new Error("socket hang up")],
    [{ id: "2-0", event: "result", data: { status: "FINISHED" } }],
  ]);
  const code = await runCursorAgent({ eventName: "issue_comment", payload: issuePayload(), repo: REPO, github, cursor, log: quiet, sleep: noSleep, commentIntervalMs: 0 });
  assert.equal(code, 0);
  assert.deepEqual(cursor.calls.streams, [undefined, "1-0"]);
  assert.match(github.calls.updates.at(-1).body, /No new commits on `feat\/x`/);
});

test("流过期就改为轮询运行状态", async () => {
  const github = fakeGithub();
  const cursor = fakeCursor([new HttpError("Cursor", "GET", "/stream", 410, "stream_expired")], { status: "ERROR", error: { message: "boom" } });
  const code = await runCursorAgent({ eventName: "issue_comment", payload: issuePayload(), repo: REPO, github, cursor, log: quiet, sleep: noSleep, commentIntervalMs: 0 });
  assert.equal(code, 1);
  assert.match(github.calls.updates.at(-1).body, /❌ Failed[\s\S]*boom/);
});

test("fork 分支与空指令不启动 agent", async () => {
  for (const [payload, pull, pattern] of [
    [issuePayload(), { head: { ref: "x", sha: "aaa", repo: { full_name: "someone/fork" } } }, /fork/],
    [issuePayload("/cursor"), undefined, /Usage/],
  ]) {
    const github = fakeGithub({ pull });
    const cursor = fakeCursor([]);
    const code = await runCursorAgent({ eventName: "issue_comment", payload, repo: REPO, github, cursor, log: quiet, sleep: noSleep, commentIntervalMs: 0 });
    assert.equal(code, 0);
    assert.equal(cursor.calls.create.length, 0);
    assert.match(github.calls.updates.at(-1).body, pattern);
  }
});

test("review comment 回复在原线程并带上文件位置", async () => {
  const github = fakeGithub();
  const cursor = fakeCursor([[{ event: "result", data: { status: "FINISHED" } }]]);
  const payload = {
    pull_request: { number: 7 },
    comment: { id: 11, in_reply_to_id: 10, body: "/cursor 这里别用 any", path: "src/a.ts", line: 3, diff_hunk: "@@ -1 +1 @@", user: { login: "lyjw131" }, html_url: "u" },
  };
  await runCursorAgent({ eventName: "pull_request_review_comment", payload, repo: REPO, github, cursor, log: quiet, sleep: noSleep, commentIntervalMs: 0 });
  assert.deepEqual(github.calls.comments[0].target.replyTo, 10);
  assert.deepEqual(github.calls.reactions[0].comment, { kind: "review", id: 11 });
  assert.match(cursor.calls.create[0].prompt.text, /`src\/a.ts` line 3/);
});

test("workflow 取消时一并取消 Cursor 运行", async () => {
  const github = fakeGithub();
  const abort = new AbortController();
  const cursor = fakeCursor([], { status: "RUNNING" });
  cursor.streamRun = async function* () {
    abort.abort();
    yield { event: "status", data: { status: "RUNNING" } };
    throw new Error("aborted");
  };
  const code = await runCursorAgent({ eventName: "issue_comment", payload: issuePayload(), repo: REPO, github, cursor, log: quiet, sleep: noSleep, signal: abort.signal, commentIntervalMs: 0 });
  assert.equal(code, 1);
  assert.equal(cursor.calls.cancel, 1);
  assert.match(github.calls.updates.at(-1).body, /⏹️ Cancelled/);
});
