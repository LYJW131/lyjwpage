/**
 * 增量曲线的长度上限。
 *
 * 这个数服务端和客户端都要用：服务端按它裁剪存量，客户端按它裁剪拼出来的
 * 序列。两边必须同源 —— 客户端留得比服务端多，多出来的那截永远填不满；留得少，
 * 翻页式的抖动。
 *
 * 单独放一个文件是因为它得同时被服务端（workers/api 的 charger-store）和浏览器
 * （charger-history）导入。搁在 charger-store 里会把服务端存储驱动拖进客户端包。
 * 这里不 import 任何东西，两边都能安全引。
 */

/**
 * 充电头功率曲线保留的采样点数。
 *
 * 必须保证「即使按最密的采样间隔，也能盖满曲线的时间窗」，否则曲线左边会空
 * 一截：采样点数 × 最小采样间隔（workers/api/src/stores/charger-store 的
 * `MIN_SAMPLE_GAP_MS`）要大于 sparkline.tsx 的 `WINDOW_MS`。改这里要和这两处一起看。
 */
export const CHARGER_HISTORY_LIMIT = 400;

/**
 * 本机 SSE 功率曲线：一帧一根柱的帧间隔，和曲线的时间窗。
 *
 * sparkline 按这两个数定槽数和柱宽，local-charging 按同一个商攒缓冲 ——
 * 攒多了是每帧白复制的死重，攒少了曲线左边空一截，所以必须同源。
 */
export const LIVE_INTERVAL_MS = 1_000;
export const LIVE_WINDOW_MS = 2 * 60 * 1000;

/** pulse 键的存活时间；每次写入都续上，停报后过了这个时间清掉。各键的条数上限见 shared/pulse-timeline。 */
export const PULSE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 充电瓦数没变时最多这么久再确认一次：上报器死了才会在图上露出缺口，
 * 心跳又不至于把 samples 表灌满。
 */
export const PULSE_REPEAT_AFTER_MS = 5 * 60 * 1000;

/**
 * pulse 公开窗口与 Coding 评分窗口。
 *
 * StateHub 留的时间更长（PULSE_TTL_MS），窗口只是取其中最近的一段：卡片画的是
 * 「今天这一天」，Jev 评的也是同一段，悬停里的强度才对得上图上的那一段。
 */
export const PULSE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * 一次观测最多撑这么久：状态区间两次确认之间、一笔瓦数到下一笔之间。
 *
 * 瓦数最迟每隔 PULSE_REPEAT_AFTER_MS 再确认一次。超过两倍还没有下一笔，那是
 * 上报器死了，不是「一直在放」—— 再撑下去，一条过夜的陈旧观测会把整夜画成实线。
 * 那段如实空着，是未知。
 */
export const PULSE_SILENT_AFTER_MS = 2 * PULSE_REPEAT_AFTER_MS;
