import type { SentryVitals } from "@/lib/sentry-status-types";

/**
 * 真实访客的性能分，0–100，和上面两行 Lighthouse 的 PERF 同一种读法。
 *
 * 做法照 Sentry 的 Performance Score（它又沿用 Lighthouse 的曲线）：每项指标按
 * 对数正态曲线映射到 0–1 —— 在 p10 处得 0.9、在中位点处得 0.5，这两个控制点就是
 * Web Vitals 的 good / poor 分界 —— 再按权重加权。缺哪一项就把剩下的权重重新归一，
 * 一项都没有是 null。
 *
 * 和 Sentry 页面上那个分不完全一样：Sentry 是逐次页面加载算分再平均，这里拿的是
 * 七天的 p75 算一次。p75 就是 Web Vitals 判定「达标」用的那个分位，读起来更保守。
 */

type Curve = { key: keyof SentryVitals; weight: number; p10: number; median: number };

const CURVES: Curve[] = [
  { key: "lcpP75Ms", weight: 0.3, p10: 2500, median: 4000 },
  { key: "inpP75Ms", weight: 0.3, p10: 200, median: 500 },
  { key: "clsP75", weight: 0.15, p10: 0.1, median: 0.25 },
  { key: "fcpP75Ms", weight: 0.15, p10: 1800, median: 3000 },
  { key: "ttfbP75Ms", weight: 0.1, p10: 800, median: 1800 },
];

/** Φ⁻¹(0.9)：p10 那一点得 0.9 分由它定出曲线的宽度 */
const Z_P10 = 1.2815515655446004;

/** 标准正态分布函数，Abramowitz–Stegun 7.1.26 的 erf 近似，误差 < 1.5e-7 */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** 单项得分：值越小越好；0 或负数（CLS 可以是 0）按满分 */
export function curveScore(value: number, p10: number, median: number): number {
  if (value <= 0) return 1;
  const sigma = Math.log(median / p10) / Z_P10;
  return 1 - normalCdf(Math.log(value / median) / sigma);
}

export function fieldPerformanceScore(vitals: SentryVitals | null | undefined): number | null {
  if (!vitals) return null;
  let weighted = 0, weights = 0;
  for (const curve of CURVES) {
    const value = vitals[curve.key];
    if (value == null) continue;
    weighted += curveScore(value, curve.p10, curve.median) * curve.weight;
    weights += curve.weight;
  }
  return weights > 0 ? Math.round((weighted / weights) * 100) : null;
}
