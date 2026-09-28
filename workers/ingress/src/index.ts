import * as Sentry from "@sentry/cloudflare";

import type { Env } from "./env";
import { sentryOptions } from "./sentry";
import { handleRequest } from "./worker";

/**
 * 上报入口 Worker：外部上报器的唯一入口（`ingest.homepage.lyjw.llc`，前面挡着 Access）。
 * 无状态：验身份、读报文、prepare，再按数据层拆开 —— 实时那一半经 Service Binding 交给
 * 状态核心，可滞后层、归档和凭据自己写。路由与拆分见 worker.ts，契约见 README。
 */
export type { Env } from "./env";

const ingress = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};

export default Sentry.withSentry(sentryOptions, ingress);
