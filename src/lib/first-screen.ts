import type { StatusPayloads } from "@/lib/status-payloads";
import type { StatusViewKey } from "@/lib/status-views";
import type { StatusResponse } from "@/lib/types";

export const FIRST_SCREEN_FETCH_TIMEOUT_MS = 20_000;

export const FIRST_SCREEN_UNAVAILABLE = "Status unavailable";

export type FirstScreen<K extends StatusViewKey> = StatusResponse<StatusPayloads[K]>;
