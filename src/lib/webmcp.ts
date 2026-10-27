import { backendUrl } from "@/lib/backend-url";
import { STATUS_VIEW_KEYS, STATUS_VIEWS, type StatusViewKey } from "@shared/status-views";

// WebMCP（https://webmachinelearning.github.io/webmcp/）只声明这里用到的部分；规范还在变，跟着最新草案改，不留旧的 navigator.modelContext。
type ToolAnnotations = { readOnlyHint?: boolean; untrustedContentHint?: boolean };
export type ModelContextTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>;
  annotations?: ToolAnnotations;
};
export type ModelContext = {
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void>;
};

declare global {
  interface Document {
    readonly modelContext?: ModelContext;
  }
}

const READ_TIMEOUT_MS = 10_000;
// 结果整段进浏览器里模型的上下文；codingYear 这类大视图截掉尾部，不分页。
const MAX_RESULT_CHARS = 20_000;

const STATUS_TOOL_NAME = "get_site_status";

function statusTool(): ModelContextTool {
  return {
    name: STATUS_TOOL_NAME,
    title: "Read live status",
    description:
      "Read one live, public status view from LYJW's homepage (the same JSON the cards on this page show): music, Mac foreground app, coding agents and token usage, games, shows, watch activity, devices, server and site health.",
    inputSchema: {
      type: "object",
      properties: { view: { type: "string", enum: STATUS_VIEW_KEYS, description: "Which status view to read" } },
      required: ["view"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      const view = input.view;
      if (typeof view !== "string" || !STATUS_VIEW_KEYS.includes(view as StatusViewKey)) {
        throw new Error(`Unknown view ${JSON.stringify(view)}. Use one of: ${STATUS_VIEW_KEYS.join(", ")}.`);
      }
      const { path } = STATUS_VIEWS[view as StatusViewKey];
      const response = await fetch(backendUrl(path), { signal: AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]) });
      if (!response.ok) throw new Error(`Reading ${view} failed with HTTP ${response.status}; try again later.`);
      const text = await response.text();
      return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: view is ${text.length} chars]` : text;
    },
  };
}

export function siteTools(): ModelContextTool[] {
  return [statusTool()];
}

export async function registerSiteTools(context: ModelContext, signal: AbortSignal): Promise<void> {
  await Promise.all(siteTools().map((tool) => context.registerTool(tool, { signal })));
}
