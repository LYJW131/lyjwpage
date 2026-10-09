import { WorkerEntrypoint } from "cloudflare:workers";
import { STATUS_VIEWS } from "@/lib/status-views";
import type { PublicStatusRpc } from "@shared/public-status";

import { executePublicRequest } from "./public-execution";
import type { Env } from "./runtime";

export function readPublicStatus(path: string, env: Env, ctx: Pick<ExecutionContext, "waitUntil">): Promise<Response> {
  if (!Object.values(STATUS_VIEWS).some((view) => view.path === path)) {
    return Promise.resolve(Response.json({ ok: false, error: "Unknown status view." }, { status: 404 }));
  }
  return executePublicRequest(new Request(`https://status.internal${path}`), env, ctx);
}

export class PublicStatus extends WorkerEntrypoint<Env> implements PublicStatusRpc {
  async readStatus(path: string): Promise<Response> {
    return readPublicStatus(path, this.env, this.ctx);
  }
}
