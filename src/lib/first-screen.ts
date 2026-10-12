import type { StatusPayloads } from "@shared/status-payloads";
import type { StatusViewKey } from "@shared/status-views";
import type { StatusResponse } from "@shared/types";

export const FIRST_SCREEN_FETCH_TIMEOUT_MS = 20_000;

export const FIRST_SCREEN_UNAVAILABLE = "Status unavailable";

export type FirstScreen<K extends StatusViewKey> = StatusResponse<StatusPayloads[K]>;
