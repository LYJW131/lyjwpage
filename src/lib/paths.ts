/**
 * /api/status/* 的路径常量。
 *
 * 这些字符串同时是 SWR 的缓存键：SSE 推送写进去的和轮询取回来的必须是同一个
 * 键，写歪一个字符就会变成两份互不相干的缓存、卡片再也不跟着推送翻。所以
 * 全站只留这一份，别在组件里手写。
 *
 * 从前它们散在 use-live-stream.ts（那是个 SSE hook，不订阅推送的组件也得从它
 * import 路径）和各个卡片里，还有硬编码的字符串。
 */

export const STREAM_PATH = "/api/status/stream";
export const DESKTOP_PATH = "/api/status/desktop";
export const TIMEZONE_PATH = "/api/status/timezone";
export const MUSIC_PATH = "/api/status/music";
export const LISTENING_PATH = "/api/status/listening";
export const CHARGER_PATH = "/api/status/charger";
export const VIBECODING_PATH = "/api/status/vibecoding";

/**
 * 正在看和列表分开：前者跟着播放事件走、快，后者 60 秒才推一次、慢。
 * 合在一个端点时慢的那半只能跟着快的那半一起被重取。
 */
export const WATCHING_PATH = "/api/status/watching";
export const NOW_WATCHING_PATH = "/api/status/watching/now";
