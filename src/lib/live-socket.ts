import { workerUrl } from "@/lib/worker-url";

/**
 * 浏览器直连 api Worker 的 `/ws`；站点不发布事件。
 *
 * 全页只有这一条 WebSocket：卡片的推送和页脚的在线人数都走它。页面切到后台也不断，
 * 只报一声 `hidden`，房间据此把它从「可见」里减掉（见 workers/api/src/live-census.ts）。
 * 握手时的可见性由调用方拼成 `?visible=1|0`。
 *
 * `process.env.X` 是构建时按文本替换的，只有写成完整字面量才替换得到。
 */
export function liveSocketUrl(): string | null {
  return workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, "/ws", { websocket: true });
}
