/**
 * 实时通道的公开参数：连哪个服务、订阅哪个频道。
 *
 * 单独一个模块，是因为浏览器要读的是同一份 —— [live-events](src/lib/live-events.ts)
 * 引了服务端的 `pusher` SDK，客户端只能从那里 `import type`，取不了值。
 * 这个模块零依赖，两侧都能引。
 *
 * 两种后端，由 `NEXT_PUBLIC_PUSHER_URL` 有无决定，没有第三条路：
 *
 * - **自部署（Sockudo）**：WebSocket 和发布用的 HTTP API 是同一个地址，
 *   一个 URL 就说完了；
 * - **云 Pusher**：这两个地址是分家的（`ws-mt1` 和 `api-mt1`），给不了一个 URL，
 *   只能报 cluster 让两边的 SDK 各自拼各自的。
 *
 * `NEXT_PUBLIC_` 前缀的变量会被编译进浏览器产物。key 和地址本来就是公开的
 * （这是个谁都能订阅的公开频道），但 `PUSHER_APP_ID` / `PUSHER_SECRET`
 * 绝不能加这个前缀 —— 加了等于把发布权限公开发布出去。
 */

/** 全站一个频道就够：浏览器不往回发东西，事件类型已经把内容分开了 */
export const LIVE_CHANNEL = "live";

export type LiveEndpoint =
  | { key: string; host: string; port: number; tls: boolean }
  | { key: string; cluster: string };

/** 没配全就返回 null，实时推送整体停用（页面退回轮询，本地开发不配也能跑） */
export function liveEndpoint(): LiveEndpoint | null {
  /*
   * 必须写成完整的 `process.env.XXX` 字面量：浏览器那侧没有 process，
   * 这几处是构建时按文本替换掉的，解构或动态取键都替换不到。
   */
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  if (!key) return null;

  const url = process.env.NEXT_PUBLIC_PUSHER_URL;
  if (!url) {
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
    return cluster ? { key, cluster } : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error("[live] NEXT_PUBLIC_PUSHER_URL 不是合法地址：", url);
    return null;
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    console.error("[live] NEXT_PUBLIC_PUSHER_URL 要用 ws:// 或 wss://：", url);
    return null;
  }

  const tls = parsed.protocol === "wss:";
  return { key, host: parsed.hostname, port: Number(parsed.port) || (tls ? 443 : 80), tls };
}
