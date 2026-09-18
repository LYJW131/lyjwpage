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

/**
 * pulse 公开窗口与评分窗口：最近 24 小时。
 *
 * StateHub 留 7 天，窗口只是取其中最近的一段：卡片画的是「今天这一天」，
 * Jev 评的也是同一段，两边必须同一个数，否则分和图对不上。
 */
export const PULSE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 一笔非空闲样本最多撑这么久。
 *
 * 阶跃序列里每个点撑到下一个点，但非空闲每 5 分钟就该再确认一次
 * （PULSE_REPEAT_AFTER_MS）。超过两倍还没有下一笔，那是上报器死了，不是
 * 「一直在放」—— 再撑下去，一条过夜的陈旧样本会把 24 小时全算成满档，
 * 图上是一条假的实线，喂给 Jev 的分钟数也跟着错。空闲不受此限：
 * 空闲本来就只留一个点，撑到下一次翻面才是它的语义。
 */
export const PULSE_SILENT_AFTER_MS = 2 * PULSE_REPEAT_AFTER_MS;

/**
 * 两次 Jev 评分之间至少隔这么久。cron 每分钟来一趟，真正调用最多十分钟一次，
 * 而且还要有比上次更新的样本才调。
 */
export const PULSE_SCORE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 没有新样本也要隔这么久重算一次：窗口跟着时间走，昨天的活动会从 24 小时里滑出去，
 * 分不跟着走的话，泳道已经空了、分还停在「Moderate」。一小时一趟，闲着时也就一天 24 次。
 */
export const PULSE_SCORE_REFRESH_MS = 60 * 60 * 1000;

/**
 * 分比这更老就不给公开端点：网关连挂这么久，与其挂着一份早已不代表当前窗口的判断，
 * 不如让卡片显示 "No scores yet"。是重算间隔的六倍，正常情况下永远碰不到。
 */
export const PULSE_SCORE_MAX_AGE_MS = 6 * PULSE_SCORE_REFRESH_MS;
