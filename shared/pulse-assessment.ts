import { CODING_MODES, CODING_WINDOW_MS, type CodingAssessment } from './pulse-coding';
import { LISTENING_MODES } from './pulse-listening';
import type { PulseDomain, PulseScore } from '../src/lib/types';
export { mergeCoverage } from './pulse-features';
/**
 * 版本 2：五个实测域不再发原始区间和图例，改发各域算好的秒数 / 次数和情境判据
 * （见 shared/pulse-features 与各 pulse-<domain>）。升版本让全部窗口重打分，
 * 不靠哈希碰巧变。
 */
export const PULSE_ASSESSMENT_VERSION = 2;
/** 每个域自己的模式集合；没有模式的域为 null。card 的标签表按 value 查。 */
export const PULSE_MODES: Partial<Record<PulseDomain, readonly string[]>> = { coding: CODING_MODES, listening: LISTENING_MODES };
export type PulseMode = { value: string; confidence: number; probabilities: Record<string, number> };
export type PulseAssessment = Omit<CodingAssessment, 'mode'> & {
  domain: PulseDomain;
  mode: PulseMode | null;
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
    // mode 是给 tooltip 的补充；它坏了只丢 mode，不把整条评估（曲线要用的强度）一起丢掉。
    const modes = PULSE_MODES[row.domain];
    let mode: PulseMode | null = null;
    if (modes && row.mode) try {
      const m = row.mode;
      if (!modes.includes(m.value) || !Number.isFinite(m.confidence) || m.confidence < 0 || m.confidence > 1) throw Error('mode');
      const probabilities = Object.fromEntries(modes.map((key) => {
        const p = m.probabilities[key]; if (!Number.isFinite(p) || p < 0 || p > 1) throw Error('mode probability'); return [key, p];
      }));
      if (Math.abs(Object.values(probabilities).reduce((a,b)=>a+b,0)-1)>0.01) throw Error('mode total');
      mode = { value: m.value, confidence: m.confidence, probabilities };
    } catch { mode = null; }
    return { domain: row.domain, from: row.from, to: row.to, coverage,
      intensity: judgment(row.intensity,4), continuity: judgment(row.continuity,3),
      mode, inputHash: row.inputHash, model: row.model, scoredAt: row.scoredAt };
  } catch { return null; }
}
