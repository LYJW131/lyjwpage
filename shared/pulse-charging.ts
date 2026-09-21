import type { PulseSample } from "@/lib/types";
import {
  longestRunSeconds,
  measuredWindow,
  percent,
  secondsWhere,
  type Coverage,
  type MeasuredRun,
  type ScoreQuestion,
} from "@shared/pulse-features";

/**
 * 充电头的五分钟事实。瓦数分档在这里算好（0 / <15 / 15–60 / ≥60 W，和
 * shared/pulse-levels 的 chargingLevel 同一把尺子），模型拿到的是每档的秒数，
 * 不再是一串带瓦数的区间外加一段塞在 state 里的判据。
 */
export type ChargingWindowFeatures = {
  observedSeconds: number;
  unknownSeconds: number;
  secondsByBand: { unplugged: number; trickle: number; moderate: number; high: number };
  /** 各档占 observedSeconds 的整数百分比 */
  percentByBand: { unplugged: number; trickle: number; moderate: number; high: number };
  peakWatts: number | null;
  longestPoweredRunSeconds: number;
  longestPoweredRunPercent: number;
};

type Band = keyof ChargingWindowFeatures["secondsByBand"];

/** 有实测瓦数按瓦数，只有旧档位就按档位——两者阈值一致。 */
export function chargingBand(run: MeasuredRun): Band {
  if (run.powerW != null) return run.powerW >= 60 ? "high" : run.powerW >= 15 ? "moderate" : run.powerW > 0 ? "trickle" : "unplugged";
  return (["unplugged", "trickle", "moderate", "high"] as const)[run.level];
}

export function chargingWindowFeatures(samples: PulseSample[], window: Coverage): { features: ChargingWindowFeatures; coverage: Coverage[] } {
  const measured = measuredWindow(samples, window);
  const watts = measured.runs.map((run) => run.powerW).filter((value): value is number => value != null);
  const band = (name: Band) => secondsWhere(measured.runs, (run) => chargingBand(run) === name);
  const secondsByBand = { unplugged: band("unplugged"), trickle: band("trickle"), moderate: band("moderate"), high: band("high") };
  const longestPoweredRunSeconds = longestRunSeconds(measured.runs, (run) => chargingBand(run) !== "unplugged");
  const of = (value: number) => percent(value, measured.observedSeconds);
  return {
    coverage: measured.coverage,
    features: {
      observedSeconds: measured.observedSeconds,
      unknownSeconds: measured.unknownSeconds,
      secondsByBand,
      percentByBand: { unplugged: of(secondsByBand.unplugged), trickle: of(secondsByBand.trickle), moderate: of(secondsByBand.moderate), high: of(secondsByBand.high) },
      peakWatts: watts.length ? Math.max(...watts) : null,
      longestPoweredRunSeconds,
      longestPoweredRunPercent: of(longestPoweredRunSeconds),
    },
  };
}

export const CHARGING_INTENSITY = [
  "Nothing drawing power: `percentByBand.unplugged` is 100.",
  "Only a trickle below 15 W, or power drawn for a small part of the observed time: `percentByBand.moderate` plus `percentByBand.high` under 25.",
  "Moderate draw of 15 to 60 W for much of the observed time (`percentByBand.moderate` 50 or above), or high draw of 60 W or more for a small part of it (`percentByBand.high` under 25).",
  "High draw of 60 W or more for much of the observed time: `percentByBand.high` between 50 and 95.",
  "High draw of 60 W or more throughout the observed time: `percentByBand.high` 95 or above.",
];
export const CHARGING_CONTINUITY = [
  "No power drawn: `percentByBand.unplugged` is 100.",
  "Power drawn only in one short burst or scattered fragments: `longestPoweredRunPercent` under 25.",
  "Power drawn for a substantial part of the observed time but with meaningful unplugged gaps: `longestPoweredRunPercent` between 25 and 75.",
  "One sustained stretch of power draw covering almost all observed time: `longestPoweredRunPercent` 75 or above.",
];

export function chargingQuestions(): { intensity: ScoreQuestion; continuity: ScoreQuestion } {
  const context = "The state describes one five-minute window of a desk charger, as precomputed seconds and integer percents of `observedSeconds` per power band. `unknownSeconds` is time with no observation: it is unknown, not unplugged. `peakWatts` is the highest measured draw, or null when only legacy band data exists.";
  return {
    intensity: { type: "score", instructions: `${context} How much power was being drawn in the observed time?`, criteria: CHARGING_INTENSITY },
    continuity: { type: "score", instructions: `${context} How continuous was the power draw in the observed time?`, criteria: CHARGING_CONTINUITY },
  };
}
