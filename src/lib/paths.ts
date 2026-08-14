/**
 * /api/status/* 的路径常量。
 *
 * 这些字符串同时是 SWR 的缓存键：推送写进去的和轮询取回来的必须是同一个
 * 键，写歪一个字符就会变成两份互不相干的缓存、卡片再也不跟着推送翻。所以
 * 全站只留这一份，别在组件里手写。
 *
 * 从前它们散在订阅推送的那个 hook（不订阅推送的组件也得从它 import 路径）
 * 和各个卡片里，还有硬编码的字符串。
 */

export const DESKTOP_PATH = "/api/status/desktop";
export const CHARGER_PATH = "/api/status/charger";
export const POWERBANK_PATH = "/api/status/powerbank";
export const VIBECODING_PATH = "/api/status/vibecoding";

/**
 * 「此刻」和「列表」分开：前者跟着播放事件走、快，后者节奏慢得多
 * （听歌 30 秒、看片 60 秒才推一次）。合在一个端点时慢的那半只能跟着
 * 快的那半一起被重取。
 *
 * 两路用同一套命名：`X` 是列表，`X/now` 是此刻。听歌那路从前叫
 * /api/status/music，和看片那对的叫法对不上。
 */
export const LISTENING_PATH = "/api/status/listening";
export const NOW_LISTENING_PATH = "/api/status/listening/now";
export const WATCHING_PATH = "/api/status/watching";
export const NOW_WATCHING_PATH = "/api/status/watching/now";
