import assert from "node:assert/strict";
import test from "node:test";

import { STATUS_VIEWS } from "@/lib/status-views";
import { handleMcp } from "./mcp.ts";
import type { ToolIO } from "./tools/registry.ts";

const MODERN = "2026-07-28";

function fakeIO(paths: string[] = []): ToolIO {
  return {
    readStatus: async (path) => {
      paths.push(path);
      return Response.json({ ok: true, path });
    },
    readDoc: async () => new Response("# Doc\nbody"),
  };
}

type Tool = { name: string; annotations: { readOnlyHint: boolean }; inputSchema: object };
type RpcBody = {
  id?: unknown;
  result?: {
    resultType?: string;
    protocolVersion?: string;
    capabilities?: unknown;
    serverInfo?: { name: string };
    instructions?: string;
    tools?: Tool[];
    content?: { text: string }[];
    isError?: boolean;
    supportedVersions?: string[];
    _meta?: Record<string, { version: string }>;
    ttlMs?: number;
    cacheScope?: string;
  };
  error?: { code: number; message: string; data?: { supported: string[]; requested: string } };
};

async function post(message: unknown, headers: Record<string, string> = {}, io = fakeIO()) {
  const request = new Request("https://api.example/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: typeof message === "string" ? message : JSON.stringify(message),
  });
  const response = await handleMcp(request, io, "test");
  const text = await response.text();
  return { response, body: (text ? JSON.parse(text) : null) as RpcBody | null };
}

const meta = (extra: Record<string, unknown> = {}) => ({
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
  ...extra,
});

function modern(id: number, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return post(
    { jsonrpc: "2.0", id, method, params: { ...params, _meta: meta() } },
    { "MCP-Protocol-Version": MODERN, "Mcp-Method": method, ...headers },
  );
}

test("旧客户端握手：回它要的版本、不发会话 ID，通知回 202，之后能列工具", async () => {
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } });
  assert.equal(init.response.status, 200);
  assert.equal(init.response.headers.get("Mcp-Session-Id"), null);
  assert.equal(init.body?.result?.protocolVersion, "2025-06-18");
  assert.deepEqual(init.body?.result?.capabilities, { tools: {} });
  assert.equal(init.body?.result?.serverInfo?.name, "lyjwpage");
  assert.match(init.body?.result?.instructions ?? "", /get_site_status/);

  const initialized = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, { "MCP-Protocol-Version": "2025-06-18" });
  assert.equal(initialized.response.status, 202);
  assert.equal(initialized.body, null);

  const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "MCP-Protocol-Version": "2025-06-18" });
  assert.equal(list.body?.result?.resultType, undefined);
  const tools = list.body?.result?.tools ?? [];
  assert.deepEqual(tools.map((tool) => tool.name), ["get_site_status", "read_project_doc"]);
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint && tool.inputSchema));
});

test("旧客户端要了不认识的版本，握手回最新的旧版本", async () => {
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } });
  assert.equal(init.body?.result?.protocolVersion, "2025-11-25");
});

test("读站点状态：只读登记过的视图，每次调用各算各的额度", async () => {
  const paths: string[] = [];
  const io = fakeIO(paths);
  const call = (views: unknown) =>
    post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_site_status", arguments: { views } } }, {}, io);
  const first = await call(["nowListening", "bogus"]);
  assert.equal(first.body?.result?.isError, false);
  const text = first.body?.result?.content?.[0].text ?? "";
  assert.match(text, /^now: \d+ /);
  assert.match(text, /## nowListening\n/);
  assert.match(text, /Ignored 1 unknown view name/);
  assert.deepEqual(paths, [STATUS_VIEWS.nowListening.path]);

  const again = await call(["nowListening"]);
  assert.equal(again.body?.result?.isError, false);
  assert.equal(paths.length, 2);

  const none = await call(["bogus"]);
  assert.equal(none.body?.result?.isError, true);
});

test("读项目文档：未知文档是工具错误，不是协议错误", async () => {
  const ok = await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "read_project_doc", arguments: { doc: "overview" } } });
  assert.equal(ok.body?.result?.isError, false);
  assert.match(ok.body?.result?.content?.[0].text ?? "", /^Source: https:\/\/github\.com\/LYJW131\/lyjwpage\/blob\/main\/README\.en\.md\n/);
  const unknown = await post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "read_project_doc", arguments: { doc: "../.dev.vars" } } });
  assert.equal(unknown.body?.result?.isError, true);
});

test("不存在的工具、非对象参数回 -32602", async () => {
  const missing = await post({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "draft_github_issue", arguments: {} } });
  assert.equal(missing.response.status, 200);
  assert.equal(missing.body?.error?.code, -32602);
  const badArgs = await post({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_site_status", arguments: ["x"] } });
  assert.equal(badArgs.body?.error?.code, -32602);
});

test("新协议：server/discover 带版本列表、resultType 与 serverInfo", async () => {
  const { response, body } = await modern(8, "server/discover");
  assert.equal(response.status, 200);
  assert.equal(body?.id, 8);
  assert.equal(body?.result?.resultType, "complete");
  assert.deepEqual(body?.result?.supportedVersions?.slice(0, 2), [MODERN, "2025-11-25"]);
  assert.deepEqual(body?.result?.capabilities, { tools: {} });
  assert.equal(body?.result?._meta?.["io.modelcontextprotocol/serverInfo"].version, "test");
  assert.ok((body?.result?.ttlMs ?? -1) >= 0);
  assert.equal(body?.result?.cacheScope, "public");
});

test("新协议：tools/list 必须带 ttlMs 与 cacheScope，否则客户端整张表都不认", async () => {
  const { body } = await modern(22, "tools/list");
  assert.equal(body?.result?.tools?.length, 2);
  assert.ok((body?.result?.ttlMs ?? -1) >= 0);
  assert.equal(body?.result?.cacheScope, "public");
});

test("新协议：tools/call 认 base64 写法的 Mcp-Name，对不上回 -32020", async () => {
  const params = { name: "get_site_status", arguments: { views: ["desktop"] } };
  const plain = await modern(9, "tools/call", params, { "Mcp-Name": "get_site_status" });
  assert.equal(plain.body?.result?.isError, false);
  const encoded = await modern(10, "tools/call", params, { "Mcp-Name": `=?base64?${btoa("get_site_status")}?=` });
  assert.equal(encoded.body?.result?.resultType, "complete");
  const wrong = await modern(11, "tools/call", params, { "Mcp-Name": "read_project_doc" });
  assert.equal(wrong.response.status, 400);
  assert.equal(wrong.body?.error?.code, -32020);
  const absent = await modern(12, "tools/call", params);
  assert.equal(absent.body?.error?.code, -32020);
});

test("新协议：头与 _meta 不一致回 -32020，缺 _meta 必填项回 -32602，都是 400", async () => {
  const noHeader = await post(
    { jsonrpc: "2.0", id: 13, method: "tools/list", params: { _meta: meta() } },
    { "Mcp-Method": "tools/list" },
  );
  assert.equal(noHeader.response.status, 400);
  assert.equal(noHeader.body?.error?.code, -32020);

  const wrongMethod = await modern(14, "tools/list", {}, { "Mcp-Method": "tools/call" });
  assert.equal(wrongMethod.body?.error?.code, -32020);

  const noMeta = await post({ jsonrpc: "2.0", id: 15, method: "tools/list" }, { "MCP-Protocol-Version": MODERN, "Mcp-Method": "tools/list" });
  assert.equal(noMeta.response.status, 400);
  assert.equal(noMeta.body?.error?.code, -32602);

  const noCapabilities = await post(
    { jsonrpc: "2.0", id: 16, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN } } },
    { "MCP-Protocol-Version": MODERN, "Mcp-Method": "tools/list" },
  );
  assert.equal(noCapabilities.body?.error?.code, -32602);
});

test("不支持的版本回 400 -32022，列出支持的版本", async () => {
  const { response, body } = await post({ jsonrpc: "2.0", id: 17, method: "tools/list" }, { "MCP-Protocol-Version": "2099-01-01" });
  assert.equal(response.status, 400);
  assert.equal(body?.error?.code, -32022);
  assert.equal(body?.error?.data?.requested, "2099-01-01");
  assert.ok(body?.error?.data?.supported.includes(MODERN) && body.error.data.supported.includes("2025-06-18"));
});

test("未知方法：新协议回 404，旧协议回 200，都带 -32601", async () => {
  const fresh = await modern(18, "resources/list");
  assert.equal(fresh.response.status, 404);
  assert.equal(fresh.body?.error?.code, -32601);
  const old = await post({ jsonrpc: "2.0", id: 19, method: "resources/list" });
  assert.equal(old.response.status, 200);
  assert.equal(old.body?.error?.code, -32601);
});

test("ping 两代都回空结果", async () => {
  assert.deepEqual((await post({ jsonrpc: "2.0", id: 20, method: "ping" })).body?.result, {});
  assert.equal((await modern(21, "ping")).body?.result?.resultType, "complete");
});

test("GET、DELETE 回 405；批量、坏 JSON、坏 id 回 400", async () => {
  for (const method of ["GET", "DELETE"]) {
    const response = await handleMcp(new Request("https://api.example/mcp", { method }), fakeIO(), "test");
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "POST");
  }
  const batch = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
  assert.equal(batch.response.status, 400);
  assert.equal(batch.body?.error?.code, -32600);
  const broken = await post("{not json");
  assert.equal(broken.body?.error?.code, -32700);
  const nullId = await post({ jsonrpc: "2.0", id: null, method: "ping" });
  assert.equal(nullId.response.status, 400);
  assert.equal(nullId.body?.error?.code, -32600);
  assert.equal(nullId.body?.id, undefined);
});
