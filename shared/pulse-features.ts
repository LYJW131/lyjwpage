/**
 * Coding 送 Jev 之前的共用小件：覆盖区间与问题的形状。
 *
 * Jev 文档（model-jaggedness）说得很直白：它不会数数、不会算时长、不会比时间戳，
 * 所以特征一律在代码里算成命名的秒数和次数（见 shared/pulse-coding 的
 * codingWindowFeatures），这里只放它和 Cursor 那一路共用的部分。
 */

export type Coverage = { from: number; to: number };

/** Jev 一问的形状。id 不发给模型，所以完整语义都写在 instructions / criteria 里。 */
export type ScoreQuestion = { type: "score"; instructions: string; criteria: string[] };
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type PulseQuestion = ScoreQuestion | ChoiceQuestion;

/**
 * 覆盖区间必须有序且不重叠 —— parsePulseAssessment 校不过就会把整条评估悄悄丢掉。
 * 来源不止一处时（Mac 观测加上 Cursor 账号观测）先并成一串再存。
 */
export function mergeCoverage(parts: Coverage[]): Coverage[] {
  const merged: Coverage[] = [];
  for (const part of parts.filter((p) => p.to > p.from).sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && part.from <= last.to) last.to = Math.max(last.to, part.to);
    else merged.push({ from: part.from, to: part.to });
  }
  return merged;
}
