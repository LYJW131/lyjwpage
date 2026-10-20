export const PULSE_DOMAINS = ["coding", "tokens", "listening", "watching", "gaming", "charging", "activity"] as const;
export type PulseDomain = (typeof PULSE_DOMAINS)[number];

export type PulsePayload = {
  generatedAt: number;
  window: { from: number; to: number };
  lanes: PulseLanes;
};

// 线上各列等长，时间为相对 window.from 的整秒；区间空缺是未知，不代表空闲。
export type PulseSpanColumns = { startSec: number[]; endSec: number[] };

export type PulseCodingLane = {
  kind: "coding";
  segments: PulseSpanColumns & { value: number[]; agentSources: number[] };
  assessments: PulseSpanColumns & { intensity: number[]; confidence: number[]; mode: (string | null)[] };
  summary: { humanSeconds: number; agentSeconds: number; bothSeconds: number };
};

export type PulseStateLane = {
  kind: "state";
  segments: PulseSpanColumns & { state: number[]; title: (string | null)[]; subtitle: (string | null)[] };
  // 只有 listening 有：从 Apple「最近播放的歌」与时长推出的别处播放；marginSec 是开播时刻的理想误差半宽
  uncertain?: PulseSpanColumns & { title: (string | null)[]; subtitle: (string | null)[]; marginSec: number[] };
  summary: { activeSeconds: number; titles: number };
};

export type PulsePowerLane = {
  kind: "power";
  segments: PulseSpanColumns & { watts: number[] };
  currentPowerW: number | null;
  summary: { peakW: number | null; energyWh: number };
};

export type PulseStepsLane = {
  kind: "steps";
  // steps 是桶分摊到 [startSec,endSec) 内的步数，跨窗口边界的桶按在内时长折算；各桶之和等于 summary.steps
  buckets: PulseSpanColumns & { steps: number[] };
  workouts: PulseSpanColumns & { activityType: string[] };
  summary: { steps: number };
};

export type PulseTokensLane = {
  kind: "tokens";
  // total = input + output + cache 读 + cache 写，与 CodingUsageDay.totalTokens 同口径；output、cacheRead 是 total 的分项。
  buckets: PulseSpanColumns & { total: number[]; output: number[]; cacheRead: number[] };
  summary: {
    peakPerMinute: number | null;
    currentPerMinute: number | null;
    totalTokens: number;
  };
};

export type PulseLanes = {
  coding: PulseCodingLane;
  tokens: PulseTokensLane;
  listening: PulseStateLane;
  watching: PulseStateLane;
  gaming: PulseStateLane;
  charging: PulsePowerLane;
  activity: PulseStepsLane;
};
