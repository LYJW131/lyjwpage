import type { PublicStatusRpc } from "@shared/public-status";

import type { BuildCoordinator } from "./build/coordinator";
import type { AnthropicEgress } from "./chat/egress";
import type { ChatQuota } from "./chat/quota";

export interface Env {
  PUBLIC_STATUS: PublicStatusRpc;
  AI?: Ai;
  ALLOWED_ORIGINS?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  ANTHROPIC_API_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  CHAT_HISTORY_SECRET?: string;
  CHAT_QUOTA?: DurableObjectNamespace<ChatQuota>;
  ANTHROPIC_EGRESS?: DurableObjectNamespace<AnthropicEgress>;
  CHAT_USAGE_LIMIT?: RateLimit;
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_ISSUE_LIMIT?: RateLimit;
  BUILD_COORDINATOR?: DurableObjectNamespace<BuildCoordinator>;
  BUILD_SESSION_SECRET?: string;
  IMAGES?: R2Bucket;
  // Managed Agents 的 agent 与 environment，须与 ANTHROPIC_API_KEY 同属一个工作区；agent 只是壳，提示词和工具每个会话从代码覆盖。
  DESIGN_AGENT_ID?: string;
  DESIGN_ENVIRONMENT_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  CODEX_REVIEW_GITHUB_TOKEN?: string;
  ROUTINE_FIRE_URL?: string;
  ROUTINE_FIRE_TOKEN?: string;
  VERCEL_TOKEN?: string;
  VERCEL_TEAM_ID?: string;
  BUILD_REQUEST_LIMIT?: RateLimit;
  MCP_LIMIT?: RateLimit;
  AI_DEV?: string;
  PREVIEW_WORKER?: string;
  CHAT_RATE_LIMIT?: string;
  CHAT_FORCE_TIER?: string;
}

export function previewWorkerEnabled(env: Env): boolean {
  return env.PREVIEW_WORKER?.trim() === "true";
}

export function aiDevEnabled(env: Env): boolean {
  return env.AI_DEV?.trim() === "true" || previewWorkerEnabled(env);
}
