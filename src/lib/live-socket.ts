/**
 * 实时推送服务的地址。
 *
 * 单独一个模块，是因为两侧要读的是同一份 —— 服务端把事件 POST 到 `/publish`，
 * 浏览器连 `/ws` 收，两个地址来自同一个 Worker（`workers/live-push`）。
 * 这个模块零依赖，两侧都能引。
 *
 * 只有一个变量：Worker 的源。两条路径写在代码里，不做成配置 ——
 * 它们和事件名一样，本来就是站点和自己那个 Worker 之间的约定，
 * 拆成两个环境变量只会多一处能对不上的地方。
 */

/** 浏览器连的 WebSocket 端点 */
const WS_PATH = "/ws";

/** 服务端发布事件的端点 */
const PUBLISH_PATH = "/publish";

/**
 * 必须写成完整的 `process.env.XXX` 字面量：浏览器那侧没有 process，
 * 这一处是构建时按文本替换掉的，解构或动态取键都替换不到。
 *
 * `NEXT_PUBLIC_` 前缀的变量会被编译进浏览器产物 —— 地址本来就是公开的
 * （谁都能连上收这份公开广播），但 `LIVE_PUSH_SECRET` 绝不能加这个前缀，
 * 加了等于把发布权限公开发布出去。
 */
function origin(): URL | null {
  const raw = process.env.NEXT_PUBLIC_LIVE_PUSH_URL;
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    console.error("[live] NEXT_PUBLIC_LIVE_PUSH_URL 不是合法地址：", raw);
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    console.error("[live] NEXT_PUBLIC_LIVE_PUSH_URL 要用 http:// 或 https://：", raw);
    return null;
  }
  return parsed;
}

/** 没配就返回 null，实时推送整体停用（页面退回轮询，本地开发不配也能跑） */
export function liveSocketUrl(): string | null {
  const url = origin();
  if (!url) return null;
  return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}${WS_PATH}`;
}

/** 同上。服务端还要另外配 `LIVE_PUSH_SECRET` 才发得出去，见 live-events 的 publish */
export function livePublishUrl(): string | null {
  const url = origin();
  if (!url) return null;
  return `${url.origin}${PUBLISH_PATH}`;
}
