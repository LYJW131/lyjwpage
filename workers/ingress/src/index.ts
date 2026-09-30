import * as Sentry from "@sentry/cloudflare";

import type { Env } from "./env";
import { sentryOptions } from "./sentry";
import { handleRequest } from "./worker";

export type { Env } from "./env";

const ingress = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};

export default Sentry.withSentry(sentryOptions, ingress);
