import * as Sentry from "@sentry/cloudflare";

import { BuildCoordinator as BuildCoordinatorBase } from "./build/coordinator";
import { AnthropicEgress as AnthropicEgressBase } from "./chat/egress";
import { ChatQuota as ChatQuotaBase } from "./chat/quota";
import { sentryOptions } from "./sentry";
import worker from "./worker";

export const ChatQuota = Sentry.instrumentDurableObjectWithSentry(sentryOptions, ChatQuotaBase);
export const AnthropicEgress = Sentry.instrumentDurableObjectWithSentry(sentryOptions, AnthropicEgressBase);
export const BuildCoordinator = Sentry.instrumentDurableObjectWithSentry(sentryOptions, BuildCoordinatorBase);
export type { Env } from "./runtime";

export default Sentry.withSentry(sentryOptions, worker);
