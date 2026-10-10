import type { StatusViewKey } from "@/lib/status-views";

import { PROJECT_DOC_TOOL, type ProjectDocKey, type ReadDoc } from "./project-docs";
import { SITE_STATUS_TOOL, type ReadStatus } from "./site-status";

export type ToolIO = { readStatus: ReadStatus; readDoc: ReadDoc };

// 读取额度的账本：首页对话一条回复共用一本，所有调用累计；MCP 每次调用各开一本新的。
export type ToolLedger = { views: Set<StatusViewKey>; docs: Set<string>; docLimit?: number };

export type ToolOutcome = {
  text: string;
  isError: boolean;
  views?: StatusViewKey[];
  doc?: { key: ProjectDocKey; heading?: string };
};

export type SiteTool = {
  name: string;
  title: string;
  description: string;
  // 账本跨整条回复时才成立的上限说明（首页对话附在 description 后面）；MCP 每次调用一本新账本，不给。
  replyCap?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
  run(input: unknown, io: ToolIO, ledger: ToolLedger): Promise<ToolOutcome>;
};

// 这里的工具全部经无鉴权的 /mcp 公开，同时是首页对话的工具：只放只读、且只读公开模型的工具。
export const SITE_TOOLS: readonly SiteTool[] = [SITE_STATUS_TOOL, PROJECT_DOC_TOOL];

export const newLedger = (): ToolLedger => ({ views: new Set(), docs: new Set() });
