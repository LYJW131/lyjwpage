// Jev 不可靠地计算时长或比较时间戳，数值特征必须预先在代码里算好。

export type Coverage = { from: number; to: number };

export type ScoreQuestion = { type: "score"; instructions: string; criteria: string[] };
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type PulseQuestion = ScoreQuestion | ChoiceQuestion;

export function mergeCoverage(parts: Coverage[]): Coverage[] {
  const merged: Coverage[] = [];
  for (const part of parts.filter((p) => p.to > p.from).sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && part.from <= last.to) last.to = Math.max(last.to, part.to);
    else merged.push({ from: part.from, to: part.to });
  }
  return merged;
}
