/**
 * 增量曲线的长度上限。
 *
 * 这个数服务端和客户端都要用：服务端按它裁剪存量，客户端按它裁剪拼出来的
 * 序列。从前两边各写一份字面量，改一处忘一处就会静默错位 —— 客户端留得比
 * 服务端多，多出来的那截永远填不满；留得少，翻页式的抖动。
 *
 * 单独放一个文件是因为它得同时被 SQLite 那侧（charger-store）和浏览器那侧
 * （charger-history）导入。搁在 charger-store 里会把 服务端存储驱动 拖进客户端包。
 * 这里不 import 任何东西，两边都能安全引。
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
 * 本机 SSE 功率曲线：约 1 Hz 一帧、一帧一根柱，窗口两分钟。
 *
 * sparkline 按这两个数定槽数和柱宽，local-charging 按同一个商攒缓冲 ——
 * 攒多了是每帧白复制的死重，攒少了曲线左边空一截，所以必须同源。
 */
export const LIVE_INTERVAL_MS = 1_000;
export const LIVE_WINDOW_MS = 2 * 60 * 1000;

/**
 * 跨域活动脉搏（pulse）：每域保留的采样条数。
 *
 * 阶跃序列，不是充电头那种密采样；600 × 5 分钟确认 ≈ 两天满载非空闲，
 * 空闲只占一条，7 天 TTL 才是真正的时间窗。改这里要和 writer 的 trim 一起看。
 */
export const PULSE_HISTORY_LIMIT = 600;

/** pulse 键的存活时间；每次 append 都续上，停报后 7 天清掉。 */
export const PULSE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 非空闲域最多这么久再确认一次。
 *
 * 序列是阶跃函数：每个点一直有效到下一个点。空闲只留一条；非空闲隔这么久
 * 再写一笔，上报器死了才会在图上露出缺口。心跳不得把 samples 表灌满。
 */
export const PULSE_REPEAT_AFTER_MS = 5 * 60 * 1000;

/** hint 入库上限；更长的标题在 compactHint 里截断。 */
export const PULSE_HINT_MAX = 48;
