import { key } from "@/lib/storage";

/**
 * 「最近在听」列表变动留下的播放痕迹。
 *
 * 和 coding 观测一样自己占一个键，不并进 `pulse:listening`：那条是阶跃序列，
 * `t` 必须单调前进，而这份证据说的是一段**已经过去**的区间；公开图表读的也是
 * 那条序列，把没有时刻的痕迹画成「此刻在放」是假的。只进评分器，见
 * workers/api/src/pulse-score.ts。
 */
export const listeningPlaysKey = () => key("pulse", "listening-plays");
