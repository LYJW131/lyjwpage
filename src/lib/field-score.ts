import type { SentryVitals } from "@/lib/sentry-status-types";


type Curve = { key: keyof SentryVitals; weight: number; p10: number; median: number };

const CURVES: Curve[] = [
  { key: "lcpP75Ms", weight: 0.3, p10: 2500, median: 4000 },
  { key: "inpP75Ms", weight: 0.3, p10: 200, median: 500 },
  { key: "clsP75", weight: 0.15, p10: 0.1, median: 0.25 },
  { key: "fcpP75Ms", weight: 0.15, p10: 1800, median: 3000 },
  { key: "ttfbP75Ms", weight: 0.1, p10: 800, median: 1800 },
];

const Z_P10 = 1.2815515655446004;

function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

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
