export type CodingTokenCounts = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; reasoningTokens: number; eventCount: number };
export type CodingTokenWindow = { from: number; to: number; agents: (CodingTokenCounts & { id: string; model: string | null })[] };
export type CodingTokenUsage = { from: number; to: number; collectedAt: number; sources: { id: string; state: 'ok' | 'partial' | 'unavailable' }[]; windows: CodingTokenWindow[] };
export function parseCodingTokenUsage(input: unknown): CodingTokenUsage | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as CodingTokenUsage;
  if (![r.from,r.to,r.collectedAt].every(Number.isSafeInteger) || r.from < 0 || r.to <= r.from || r.to > r.collectedAt || r.to-r.from > 25*3600_000 || !Array.isArray(r.sources) || !Array.isArray(r.windows) || r.windows.length > 301) return null;
  const sources: CodingTokenUsage['sources'] = [];
  for (const s of r.sources) {
    if (!s || !['codex','claude'].includes(s.id) || !['ok','partial','unavailable'].includes(s.state) || sources.some((v)=>v.id===s.id)) return null;
    sources.push({id:s.id,state:s.state});
  }
  if (sources.length !== 2) return null;
  const windows: CodingTokenWindow[] = [];
  for (const w of r.windows) {
    if (!w || !Number.isSafeInteger(w.from) || w.from % 300000 || w.to !== w.from+300000 || w.from < Math.floor(r.from/300000)*300000 || w.from >= r.to || !Array.isArray(w.agents) || w.agents.length>32 || windows.some((v)=>v.from===w.from)) return null;
    const agents: CodingTokenWindow['agents'] = [];
    for (const a of w.agents) {
      if (!a || !sources.some((s)=>s.id===a.id) || (a.model != null && (typeof a.model !== 'string' || a.model.length>80))) return null;
      const keys = ['inputTokens','outputTokens','cacheReadTokens','cacheCreationTokens','reasoningTokens','eventCount'] as const;
      if (!keys.every((k)=>Number.isSafeInteger(a[k]) && a[k]>=0) || a.reasoningTokens>a.outputTokens || agents.some((v)=>v.id===a.id&&v.model===a.model)) return null;
      agents.push({id:a.id,model:a.model??null,...Object.fromEntries(keys.map((k)=>[k,a[k]]))} as CodingTokenWindow['agents'][number]);
    }
    windows.push({from:w.from,to:w.to,agents});
  }
  return {from:r.from,to:r.to,collectedAt:r.collectedAt,sources,windows};
}
