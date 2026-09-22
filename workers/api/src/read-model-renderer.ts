import { WorkerEntrypoint } from "cloudflare:workers";
import { executePublicRequest } from "./public-execution";
import { readModelPolicy } from "./read-model";
import type { Env } from "./runtime";

/** Internal-only compute entrypoint used by StateHub's durable publication queue. */
export class ReadModelRenderer extends WorkerEntrypoint<Env> {
  async render(path: string): Promise<Response> {
    if (!readModelPolicy(path)) return new Response("Not found", { status: 404 });
    return executePublicRequest(new Request(`https://read-model.internal${path}`), this.env, this.ctx);
  }

  /** Local WebSocket relay lookup; the caller supplies only an already-mapped public status path. */
  async devOverride(path: string): Promise<Response> {
    if (!path.startsWith("/api/status/")) return new Response("Not found", { status: 404 });
    return executePublicRequest(
      new Request(`https://dev-override.internal/api/dev/override${path}`),
      this.env,
      this.ctx,
    );
  }
}
