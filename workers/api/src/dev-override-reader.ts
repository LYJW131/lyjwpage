import { WorkerEntrypoint } from "cloudflare:workers";
import { executePublicRequest } from "./public-execution";
import type { Env } from "./runtime";

export class DevOverrideReader extends WorkerEntrypoint<Env> {
  async devOverride(path: string): Promise<Response> {
    if (!path.startsWith("/api/status/")) return new Response("Not found", { status: 404 });
    return executePublicRequest(
      new Request(`https://dev-override.internal/api/dev/override${path}`),
      this.env,
      this.ctx,
    );
  }
}
