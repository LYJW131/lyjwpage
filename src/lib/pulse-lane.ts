import { PULSE_LEVEL_MAX } from "@/lib/types";

/**
 * 把一条域的阶跃点画成泳道。纯函数，卡片只负责把返回的 `d` 塞进 `<path>`。
 *
 * 画阶跃而不是折线：`{ t, level }` 说的是「从这一刻起是这个档，直到下一点」，
 * 连成斜线等于声称中间那段在连续变化 —— 那是假的，档位只在上报时刻翻面。
 *
 * viewBox 固定 0..width × 0..height，x 由窗口线性映射（不按点均分：点是不规则
 * 采样的，均分会让一段 5 分钟的高档看起来和一段 5 小时的一样长）。
 */

export type PulseLanePoint = { t: number; level: number; until?: number };
export type PulseLaneWindow = { from: number; to: number };

export type PulseLaneShape = {
  /** 填充用的闭合路径；没有可画的段时为空串 */
  area: string;
  /** 顶边折线，画描边用；同样可能是空串 */
  line: string;
};

/** 一段静默：上一点撑满 silentAfterMs 之后还没有下一点，那段就断开 */
type Run = { from: number; to: number; level: number };

export function pulseLaneRuns(
  points: PulseLanePoint[],
  window: PulseLaneWindow,
  silentAfterMs: number,
): Run[] {
  const runs: Run[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const nextAt = index + 1 < points.length ? points[index + 1].t : window.to;
    const from = Math.max(point.t, window.from);
    const to = Math.min(point.until != null ? Math.min(nextAt, point.until) : point.level === 0 ? nextAt : Math.min(nextAt, point.t + silentAfterMs), window.to);
    if (to <= from) continue;
    const previous = runs[runs.length - 1];
    if (previous && previous.to === from && previous.level === point.level) previous.to = to;
    else runs.push({ from, to, level: point.level });
  }
  return runs;
}

/**
 * 段 → SVG 路径。
 *
 * 0 档也照画一条贴着底边的段：泳道要连续，断开的地方才是「没有上报」。
 * 所以填充路径里 0 档的高度是 0（看不见），而顶边折线仍然走过去，
 * 静默那一段两条都不画。
 */
export function pulseLanePath(
  points: PulseLanePoint[],
  window: PulseLaneWindow,
  options: { width: number; height: number; silentAfterMs: number },
): PulseLaneShape {
  const span = Math.max(1, window.to - window.from);
  // 一位小数足够：泳道 viewBox 只有几百单位宽，第二位小数在屏幕上不到一像素的零头，
  // 却让首屏 HTML 里每条路径多出三成字符
  const x = (at: number) => (((at - window.from) / span) * options.width).toFixed(1);
  const y = (level: number) => (options.height - (level / PULSE_LEVEL_MAX) * options.height).toFixed(1);
  const floor = options.height.toFixed(1);

  // 先按「首尾相接」分组：一组是一笔连续的泳道，组与组之间就是静默的空白
  const chains: Run[][] = [];
  for (const run of pulseLaneRuns(points, window, options.silentAfterMs)) {
    const chain = chains[chains.length - 1];
    if (chain && chain[chain.length - 1].to === run.from) chain.push(run);
    else chains.push([run]);
  }
  if (!chains.length) return { area: "", line: "" };

  const area: string[] = [];
  const line: string[] = [];
  for (const chain of chains) {
    const head = chain[0];
    const tail = chain[chain.length - 1];
    area.push(`M${x(head.from)} ${floor}`, `L${x(head.from)} ${y(head.level)}`);
    line.push(`M${x(head.from)} ${y(head.level)}`);
    for (const run of chain) {
      // 翻面处先竖着走到新高度，再横着走完这一段 —— 阶跃就是这两笔。
      // 首段的竖笔已经由上面那一起笔走过了，不再重复一次。
      if (run !== head) {
        area.push(`L${x(run.from)} ${y(run.level)}`);
        line.push(`L${x(run.from)} ${y(run.level)}`);
      }
      area.push(`L${x(run.to)} ${y(run.level)}`);
      line.push(`L${x(run.to)} ${y(run.level)}`);
    }
    area.push(`L${x(tail.to)} ${floor}`, "Z");
  }

  return { area: area.join(" "), line: line.join(" ") };
}

/** 四档标尺上的位置 → 那一档的词。四舍五入，夹在 0..3。 */
const SCORE_WORDS = ["Idle", "Light", "Moderate", "Intense"] as const;
export function pulseScoreWord(value: number): string {
  const index = Math.min(SCORE_WORDS.length - 1, Math.max(0, Math.round(value)));
  return SCORE_WORDS[index];
}
