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
/** 年度 token 热力图。没有推送；浏览器按长间隔和切回焦点来问，切回带游标。 */
export const VIBECODING_YEAR_PATH = "/api/status/vibecoding/year";

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
export const PLAYING_PATH = "/api/status/playing";
export const NOW_PLAYING_PATH = "/api/status/playing/now";

/**
 * 奖杯目录。没有「此刻」—— 解锁不是按秒翻面的事，不配 /now，
 * 也不走推送（整份目录几百 KB，广播它就是把推送当轮询用）。
 * 首页点瓷砖才拉，而且只拉那块瓷砖对上的 1–2 款，见下面的 trophiesTilePath。
 */
export const TROPHIES_PATH = "/api/status/trophies";

/**
 * 一块瓷砖要的那几款奖杯。
 *
 * 拼在这里而不是组件里，理由和上面那些常量是同一条：它同样是个 SWR 缓存键
 * （每块打开过的瓷砖各一个），而且这串参数就是切片语义本身 —— 服务端按
 * titleIds 求交集，不带它才发整份。
 *
 * titleId 先排序：同一块瓷砖的 titleIds 顺序跟着最近游玩列表走，列表一重排
 * 就会拼出另一个键，同一份数据被取第二遍、面板还闪一下加载态。
 */
export function trophiesTilePath(titleIds: string[]): string {
  const ids = [...titleIds].sort().join(",");
  return `${TROPHIES_PATH}?titleids=${encodeURIComponent(ids)}`;
}

/** 贡献热力图。没有推送；浏览器按长间隔和切回焦点来问，切回带游标。 */
export const GITHUB_CHART_PATH = "/api/status/github-chart";

/**
 * 活动圆环。没有推送 —— 圈以分钟为尺度涨，广播它就是拿推送当轮询用，
 * 所以这个键只会被轮询和首屏填。
 */
export const ACTIVITY_PATH = "/api/status/activity";

/**
 * 落地节点的此刻。没有「列表」—— 一台机器一份快照，不配 /now，
 * 也不走推送（CPU 和网速每个间隔都在变，广播就是拿推送当轮询用）。
 */
export const SERVER_PATH = "/api/status/server";
