import type { EndpointPayloadOf } from "@/lib/status-loaders";
import type { StatusViewKey } from "@/lib/status-views";
import type { StatusResponse } from "@/lib/types";

// 上游故障必须抛出以保留上一份首屏缓存；未部署端点的 404 才降级为空卡片。
export const FIRST_SCREEN_FETCH_TIMEOUT_MS = 20_000;

export const FIRST_SCREEN_UNAVAILABLE = "Status unavailable";

export type FirstScreen<K extends StatusViewKey> = StatusResponse<EndpointPayloadOf<K>>;
