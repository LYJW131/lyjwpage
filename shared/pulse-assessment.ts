import { CODING_WINDOW_MS, parseCodingAssessment, type CodingAssessment } from './pulse-coding';
import type { PulseDomain, PulseScore } from '../src/lib/types';
export const PULSE_ASSESSMENT_VERSION = 1;
export type PulseAssessment = Omit<CodingAssessment, 'mode'> & {
  domain: PulseDomain;
  mode: CodingAssessment['mode'] | null;
  inputHash: string;
};
/** Summary and graph use exactly the same scores. Unknown time is excluded, never zero-filled. */
export function summarizeAssessments(rows: PulseAssessment[], from: number, to: number): PulseScore | null {
  const mean = (start: number, end: number) => {
    let weight = 0, value = 0, confidence = 0;
    for (const row of rows) for (const part of row.coverage) {
      const duration = Math.max(0, Math.min(part.to, end) - Math.max(part.from, start));
      weight += duration; value += row.intensity.value / 4 * 3 * duration;
      confidence += row.intensity.confidence * duration;
    }
    return weight ? { value: value / weight, confidence: confidence / weight } : null;
  };
  const total = mean(from, to);
  if (!total) return null;
  const recent = mean(Math.max(from, to - 3 * 3600_000), to);
  const prior = mean(Math.max(from, to - 6 * 3600_000), to - 3 * 3600_000);
  const delta = recent && prior ? recent.value - prior.value : null;
  return { ...total, trend: delta == null ? 'unknown' : delta > 0.2 ? 'rising' : delta < -0.2 ? 'falling' : 'steady',
    scoredAt: Math.max(...rows.map((r) => r.scoredAt)) };
}
export function parsePulseAssessment(raw: string): PulseAssessment | null {
  try {
    const row = JSON.parse(raw) as PulseAssessment;
    if (!['coding','listening','watching','gaming','charging','activity'].includes(row.domain) || typeof row.inputHash !== 'string') return null;
    if (!Number.isSafeInteger(row.from) || row.from < 0 || row.to !== row.from + CODING_WINDOW_MS || !Number.isFinite(row.scoredAt)) return null;
    if (!Array.isArray(row.coverage) || !row.coverage.length) return null;
    let end = row.from;
    const coverage = row.coverage.map((p) => {
      if (!Number.isFinite(p.from) || !Number.isFinite(p.to) || p.from < end || p.to <= p.from || p.to > row.to) throw Error('coverage');
      end = p.to; return { from: p.from, to: p.to };
    });
    const judgment = (j: PulseAssessment['intensity'], maximum: number) => {
      if (!j || !Number.isFinite(j.value) || j.value < 0 || j.value > maximum || !Number.isFinite(j.confidence) || j.confidence < 0 || j.confidence > 1) throw Error('score');
      const probabilities = Object.fromEntries(Array.from({length: maximum + 1}, (_, i) => {
        const p = j.probabilities[String(i)]; if (!Number.isFinite(p) || p < 0 || p > 1) throw Error('probability'); return [String(i), p];
      }));
      if (Math.abs(Object.values(probabilities).reduce((a,b)=>a+b,0)-1)>0.01) throw Error('total');
      return { value: j.value, confidence: j.confidence, probabilities };
    };
    if (typeof row.model !== 'string' || !row.model) return null;
    return { domain: row.domain, from: row.from, to: row.to, coverage,
      intensity: judgment(row.intensity,4), continuity: judgment(row.continuity,3),
      mode: row.domain === 'coding' ? parseCodingAssessment(raw)?.mode ?? null : null, inputHash: row.inputHash, model: row.model, scoredAt: row.scoredAt };
  } catch { return null; }
}
