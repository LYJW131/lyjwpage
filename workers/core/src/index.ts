import * as Sentry from "@sentry/cloudflare";

import originWorker, { LivePushRoom as LivePushRoomBase, StateHub as StateHubBase } from "./origin-worker";
import type { Env } from "./runtime";
import { DevOverrideReader as DevOverrideReaderBase } from "./dev-override-reader";
import { StateCore as StateCoreBase } from "./state-core";
import { PublicStatus as PublicStatusBase } from "./public-status";
import { installApiPorts } from "./ports";
import { sentryOptions } from "./sentry";

installApiPorts();

// Wrangler 迁移按导出名识别 DO；Sentry 包装不能改变这些名称。
export const LivePushRoom = Sentry.instrumentDurableObjectWithSentry(sentryOptions, LivePushRoomBase);
export const StateHub = Sentry.instrumentDurableObjectWithSentry(sentryOptions, StateHubBase);
export const StateCore = Sentry.withSentry(sentryOptions, StateCoreBase);
export const PublicStatus = Sentry.withSentry(sentryOptions, PublicStatusBase);
export const DevOverrideReader = Sentry.withSentry(sentryOptions, DevOverrideReaderBase);
export type { Env } from "./runtime";

const coreWorker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return originWorker.fetch(request, env, ctx);
  },
};

export default Sentry.withSentry(sentryOptions, coreWorker);
