import assert from "node:assert/strict";
import test from "node:test";

import { STATUS_VIEWS } from "@/lib/status-views";
import { handleMcp } from "./mcp.ts";
import { CODE_TOOL, formatOutcome, sandboxModule } from "./tools/code-mode.ts";
import { newLedger, type ToolIO } from "./tools/registry.ts";

const io = (paths: string[] = []): ToolIO => ({
  readStatus: async (path) => {
    paths.push(path);
    return Response.json({ games: [{ name: "Hades" }] });
  },
  readDoc: async () => new Response(""),
  runCode: async (_code, status) => {
    try {
      return { ok: true, result: await Promise.all([status("playing"), status("playing")]) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  },
});

test("代码工具只在有 runCode 时出现在 MCP 工具表里", async () => {
  const list = async (tools: ToolIO) => {
    const response = await handleMcp(
      new Request("https://x/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), headers: { "MCP-Protocol-Version": "2025-06-18" } }),
      tools,
      "t",
    );
    return ((await response.json()) as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name);
  };
  assert.deepEqual(await list({ ...io(), runCode: undefined }), ["get_site_status", "read_project_doc"]);
  assert.deepEqual(await list(io()), ["get_site_status", "read_project_doc", "run_site_code"]);
});

test("同一次运行重复读同一视图只占一次额度，views 记进账本", async () => {
  const paths: string[] = [];
  const ledger = newLedger();
  const outcome = await CODE_TOOL.run({ code: "return 1" }, io(paths), ledger);
  assert.equal(outcome.isError, false);
  assert.deepEqual(paths, [STATUS_VIEWS.playing.path]);
  assert.equal(ledger.reads?.size, 1);
  assert.deepEqual(outcome.views, ["playing"]);
});

test("读取额度与 get_site_status 共用，用完后代码读取失败", async () => {
  const ledger = newLedger();
  for (let i = 0; i < 8; i++) ledger.reads?.add(`x${i}`);
  const outcome = await CODE_TOOL.run({ code: "return 1" }, io(), ledger);
  assert.equal(outcome.isError, true);
  assert.match(outcome.text, /at most 8/);
});

test("坏输入、过长代码、未开启都回错误结果，输出被截断", async () => {
  assert.equal((await CODE_TOOL.run({}, io(), newLedger())).isError, true);
  assert.match((await CODE_TOOL.run({ code: "x".repeat(5000) }, io(), newLedger())).text, /longer than/);
  assert.match((await CODE_TOOL.run({ code: "1" }, { ...io(), runCode: undefined }, newLedger())).text, /not enabled/);
  const big = formatOutcome({ ok: true, result: "a".repeat(20_000) });
  assert.match(big.text, /…\[truncated/);
  assert.ok(big.text.length < 8_100);
});

test("沙箱模块把代码放进 async 函数体并捕获异常", () => {
  const source = sandboxModule("return await status('playing');");
  assert.match(source, /env\.STATUS\.read\(view\)/);
  assert.match(source, /return await status\('playing'\);/);
  assert.match(source, /catch \(error\)/);
});
