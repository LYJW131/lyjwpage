import { workerUrl } from "@/lib/worker-url";

/**
 * 浏览器分别直连 API 与在线人数 Worker；站点不发布事件。
 *
 * 两个源分别配置，路径在这儿拼。`process.env.X` 是构建时按文本替换的，只有写成完整
 * 字面量才替换得到，所以两处各自读、不抽成参数。
 */

/** 事件推送：页面开着就一直挂着，Worker 那侧数它作「开着」的页面。 */
export function liveSocketUrl(): string | null {
  return workerUrl(process.env.NEXT_PUBLIC_BACKEND_URL, "/ws", { websocket: true });
}

/** 此刻在线：页面不可见时整条关掉，Worker 那侧数它作「可见」的页面。 */
export function onlineSocketUrl(): string | null {
  return workerUrl(process.env.NEXT_PUBLIC_ONLINE_COUNTER_URL, "/ws", { websocket: true });
}
