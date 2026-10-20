export type Coverage = { from: number; to: number };

export function mergeCoverage(parts: Coverage[]): Coverage[] {
  const merged: Coverage[] = [];
  for (const part of parts.filter((p) => p.to > p.from).sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && part.from <= last.to) last.to = Math.max(last.to, part.to);
    else merged.push({ from: part.from, to: part.to });
  }
  return merged;
}
