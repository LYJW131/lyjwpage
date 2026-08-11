/**
 * 增量曲线的长度上限。
 *
 * 这两个数服务端和客户端都要用：服务端按它裁剪存量，客户端按它裁剪拼出来的
 * 序列。从前两边各写一份字面量，改一处忘一处就会静默错位 —— 客户端留得比
 * 服务端多，多出来的那截永远填不满；留得少，翻页式的抖动。
 *
 * 单独放一个文件是因为它得同时被 Redis 那侧（charger-store）和浏览器那侧
 * （charger-history / vibecoding-activity）导入。搁在 charger-store 里会把
 * ioredis 拖进客户端包。这里不 import 任何东西，两边都能安全引。
 */

/**
 * 充电头功率曲线保留的采样点数。
 *
 * 必须保证「即使按最密的采样间隔，也能盖满曲线的时间窗」，否则曲线左边会空
 * 一截：400 × MIN_SAMPLE_GAP(5s) = 33 分钟 > sparkline 的 WINDOW_MS(20 分钟)。
 * 改这里要和 sparkline.tsx 的 WINDOW_MS 一起看。
 */
export const CHARGER_HISTORY_LIMIT = 400;

/**
 * vibe coding 活动曲线的桶数。
 *
 * 上游固定给 30 个：一天一桶，也就是最近 30 天。入库时按这个数校验，客户端按这个数
 * 裁剪。不是可调参数 —— 要改得先改上游的产出。
 */
export const VIBECODING_ACTIVITY_LIMIT = 30;
