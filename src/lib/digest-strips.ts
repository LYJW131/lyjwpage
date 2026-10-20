import type { DigestTopic } from "@shared/digest";
import { isCodingDriverValue } from "@shared/pulse-types";
import type { PulsePayload, PulseSpanColumns } from "@shared/types";

export const STRIP_BINS = 48;

function windowSeconds(pulse: PulsePayload) {
  return (pulse.window.to - pulse.window.from) / 1000;
}

function coverage(spans: PulseSpanColumns, keep: (index: number) => boolean, seconds: number): number[] {
  const width = seconds / STRIP_BINS;
  const bins = new Array<number>(STRIP_BINS).fill(0);
  spans.startSec.forEach((start, index) => {
    if (!keep(index)) return;
    const end = spans.endSec[index];
    for (let bin = Math.max(0, Math.floor(start / width)); bin < STRIP_BINS && bin * width < end; bin += 1) {
      bins[bin] += Math.max(0, Math.min(end, (bin + 1) * width) - Math.max(start, bin * width)) / width;
    }
  });
  return bins.map((value) => Math.min(1, value));
}

function amounts(spans: PulseSpanColumns, values: number[], seconds: number): number[] {
  const width = seconds / STRIP_BINS;
  const bins = new Array<number>(STRIP_BINS).fill(0);
  spans.startSec.forEach((start, index) => {
    bins[Math.min(STRIP_BINS - 1, Math.max(0, Math.floor(start / width)))] += values[index] ?? 0;
  });
  const peak = Math.max(...bins);
  return peak > 0 ? bins.map((value) => value / peak) : bins;
}

// 每格 0–1：时段类是这一格里在做这件事的时间占比，数量类（token、步数）是相对 24 小时内峰值的高度。
export function topicStrip(topic: DigestTopic, pulse: PulsePayload): number[] | null {
  const { lanes } = pulse;
  const seconds = windowSeconds(pulse);
  const strip = (() => {
    switch (topic) {
      case "coding": return coverage(lanes.coding.segments, (index) => isCodingDriverValue(lanes.coding.segments.value[index]), seconds);
      case "agents": return coverage(lanes.coding.segments, (index) => lanes.coding.segments.value[index] >= 2, seconds);
      case "tokens": return amounts(lanes.tokens.buckets, lanes.tokens.buckets.total, seconds);
      case "music": {
        const played = coverage(lanes.listening.segments, (index) => lanes.listening.segments.state[index] >= 2, seconds);
        const inferred = lanes.listening.uncertain ? coverage(lanes.listening.uncertain, () => true, seconds) : null;
        return inferred ? played.map((value, index) => Math.min(1, value + inferred[index])) : played;
      }
      case "watching": return coverage(lanes.watching.segments, (index) => lanes.watching.segments.state[index] >= 2, seconds);
      case "gaming": return coverage(lanes.gaming.segments, (index) => lanes.gaming.segments.state[index] >= 2, seconds);
      case "fitness": return amounts(lanes.activity.buckets, lanes.activity.buckets.steps, seconds);
      default: return null;
    }
  })();
  return strip?.some((value) => value > 0) ? strip : null;
}
