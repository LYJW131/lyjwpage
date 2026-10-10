import { STATUS_VIEWS, type StatusViewKey } from "@/lib/status-views";

import type { CodeRun, SiteTool, ToolIO, ToolLedger } from "./registry";
import { claimViews, isStatusViewKey } from "./site-status";

const MAX_CODE_CHARS = 4_000;
const MAX_OUTPUT_CHARS = 8_000;
export const CODE_TIMEOUT_MS = 5_000;

// 沙箱里的代码拿到的是 status(view)：同一份公开 JSON（含图片字段，不分页不精简），读取额度走这条回复的账本。
// 同一次运行里重复读同一视图复用结果，不再占额度。
export function statusBridge(io: ToolIO, ledger: ToolLedger) {
  const cache = new Map<StatusViewKey, Promise<unknown>>();
  return (view: unknown): Promise<unknown> => {
    if (!isStatusViewKey(view)) return Promise.reject(new Error(`Unknown view: ${String(view)}`));
    const cached = cache.get(view);
    if (cached) return cached;
    const { views, notes } = claimViews([view], ledger, { offset: 0, query: "", detail: "full" });
    if (!views.length) return Promise.reject(new Error(notes.join(" ") || `Not read: ${view}`));
    const read = io.readStatus(STATUS_VIEWS[view].path).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    cache.set(view, read);
    return read;
  };
}

export function sandboxModule(code: string): string {
  return [
    "export default {",
    "  async fetch(request, env) {",
    "    try {",
    "      const status = (view) => env.STATUS.read(view);",
    "      const result = await (async () => {",
    code,
    "      })();",
    "      return Response.json({ ok: true, result: result === undefined ? null : result });",
    "    } catch (error) {",
    "      return Response.json({ ok: false, error: String(error && error.message || error) });",
    "    }",
    "  },",
    "};",
  ].join("\n");
}

export function formatOutcome(outcome: CodeRun): { text: string; isError: boolean } {
  if (!outcome.ok) return { text: `Code failed: ${outcome.error}`, isError: true };
  const json = JSON.stringify(outcome.result) ?? "null";
  return { text: json.length > MAX_OUTPUT_CHARS ? `${json.slice(0, MAX_OUTPUT_CHARS)}…[truncated; return less data]` : json, isError: false };
}

export const CODE_TOOL: SiteTool = {
  name: "run_site_code",
  title: "Query LYJW's live status with code",
  description: [
    "Write JavaScript that queries LYJW's live homepage data and returns only the answer, instead of reading whole views.",
    "The code is the body of an async function: use `await status(view)` to get a view's full parsed JSON (the same data get_site_status serves, with image fields, unpaged), filter or aggregate it, then `return` a JSON-serializable value.",
    "The sandbox has no network and no other APIs. A run is limited in time and the returned value is truncated, so return only what you need.",
    "Reads count against the same per-reply view limit as get_site_status; reading the same view twice in one run costs once.",
    "Timestamps are epoch milliseconds. View names are listed in get_site_status.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      code: { type: "string", description: `Function body, at most ${MAX_CODE_CHARS} characters; must return the result` },
    },
    required: ["code"],
    additionalProperties: false,
  },
  async run(input, io, ledger) {
    const code = (input as { code?: unknown } | null)?.code;
    if (typeof code !== "string" || !code.trim()) return { text: "code must be a non-empty string.", isError: true };
    if (code.length > MAX_CODE_CHARS) return { text: `code is longer than ${MAX_CODE_CHARS} characters.`, isError: true };
    if (!io.runCode) return { text: "Code mode is not enabled.", isError: true };
    const bridge = statusBridge(io, ledger);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        io.runCode(code, bridge),
        new Promise<CodeRun>((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, error: "timed out" }), CODE_TIMEOUT_MS);
        }),
      ]);
      return { ...formatOutcome(outcome), ...(ledger.views.size && { views: [...ledger.views] }) };
    } catch (error) {
      return { text: `Code failed: ${error instanceof Error ? error.message : "sandbox error"}`, isError: true };
    } finally {
      clearTimeout(timer);
    }
  },
};
