import type { Env } from "./env";
import { handleRequest } from "./worker";

export type { Env } from "./env";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};
