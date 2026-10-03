import { CODING_MODES, CODING_WINDOW_MS, PULSE_SCORE_WINDOW_MS, type CodingAssessment } from './pulse-coding';
export { mergeCoverage } from './pulse-features';
export const SCORED_DOMAINS = ['coding'] as const;
export type PulseScoredDomain = (typeof SCORED_DOMAINS)[number];
// 判据变更必须升版本，确保输入哈希使所有窗口重新评估。
export const PULSE_ASSESSMENT_VERSION = 7;
export const PULSE_MODES: Record<PulseScoredDomain, readonly string[]> = { coding: CODING_MODES };
export type PulseMode = { value: string; confidence: number; probabilities: Record<string, number> };
export type PulseAssessment = Omit<CodingAssessment, 'mode'> & {
  domain: PulseScoredDomain;
  mode: PulseMode | null;
  inputHash: string;
};
export function parsePulseAssessment(raw: string): PulseAssessment | null {
  try {
    const row = JSON.parse(raw) as PulseAssessment;
    if (!(SCORED_DOMAINS as readonly string[]).includes(row.domain) || typeof row.inputHash !== 'string') return null;
    if (!Number.isSafeInteger(row.from) || row.from < 0 || (row.to !== row.from + CODING_WINDOW_MS && row.to !== row.from + PULSE_SCORE_WINDOW_MS) || !Number.isFinite(row.scoredAt)) return null;
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

export function latestPulseAssessments(rows: readonly string[]): PulseAssessment[] {
  const latest = new Map<string, PulseAssessment>();
  for (const raw of rows) {
    const row = parsePulseAssessment(raw);
    if (!row) continue;
    const key = `${row.domain}:${row.from}:${row.to}`;
    latest.delete(key);
    latest.set(key, row);
  }
  const current = [...latest.values()];
  const wide = new Set(current.filter((row) => row.to - row.from === PULSE_SCORE_WINDOW_MS).map((row) => `${row.domain}:${row.from}`));
  return current.filter((row) => row.to - row.from === PULSE_SCORE_WINDOW_MS || !wide.has(`${row.domain}:${Math.floor(row.from / PULSE_SCORE_WINDOW_MS) * PULSE_SCORE_WINDOW_MS}`))
    .sort((a, b) => a.from - b.from || a.domain.localeCompare(b.domain));
}
