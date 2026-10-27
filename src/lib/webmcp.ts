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

// 只对 https://lyjw.me 生效，到期后 Chrome 忽略它；令牌本身公开。
export const WEBMCP_ORIGIN_TRIAL_TOKEN =
  "ApxnjBvae+a+Fix9D9mcxvYMD7fs34z9qI8gOeMkhFNUT5rLNSf9gwTHo6cJKIbroZMZKyU+i1Ic0Ucx+cqfyQkAAABHeyJvcmlnaW4iOiJodHRwczovL2x5ancubWU6NDQzIiwiZmVhdHVyZSI6IldlYk1DUCIsImV4cGlyeSI6MTgwNjM2NDgwMH0=";

// 声明式 API（https://developer.chrome.com/docs/ai/webmcp/declarative-api）的表单属性，展开到元素上；React 不认识它们，原样写进 DOM。
// 不加 toolautosubmit：agent 只把消息填进输入框，发送仍要访客自己点，额度与人机验证都按访客算。
export const CHAT_FORM_TOOL = {
  toolname: "ask_homepage_chat",
  tooldescription:
    "Draft a message to the chat on LYJW's homepage, which answers questions about LYJW and this site. The visitor reviews it and presses Send themselves.",
};
export const CHAT_MESSAGE_PARAM = { toolparamdescription: "The question or message to send, in the visitor's language" };

type AgentSubmitEvent = Event & { agentInvoked?: boolean; respondWith?: (result: Promise<unknown>) => void };

// 声明式工具的表单被 agent 激活后，提交时调了 preventDefault 就必须 respondWith，否则 Chrome 判工具调用失败。
export function answerAgentSubmit(event: Event, result: string): void {
  const submit = event as AgentSubmitEvent;
  if (submit.agentInvoked) submit.respondWith?.(Promise.resolve(result));
}

export function chatSubmitResult(draft: string, streaming: boolean): string {
  if (!draft.trim()) return "Nothing was sent: the message box is empty.";
  if (streaming) return "Nothing was sent: the chat is still writing its previous reply. The message stays in the box; the visitor can send it once that reply finishes.";
  return "The visitor submitted the message. A first-time visitor must accept the privacy notice before it is sent; the reply then appears in the chat on the page.";
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
