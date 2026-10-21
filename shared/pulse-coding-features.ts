import type { StoredCodingBuckets } from './coding-buckets';
import { CODING_BUCKET_MS, codingRowTokens } from './coding-usage';
import { cursorWindowFeatures, type CursorObservation } from './pulse-cursor';
import { mergeCoverage, type Coverage } from './pulse-features';
import type { CodingObservation } from './pulse-coding';

export const CODING_OBSERVATION_HOLD_MS = 3 * 60_000;

// 云端没有在线心跳，只有用量桶这一正证据：有用量的桶算 agent 在跑，没有桶是未知而非空闲。
export function cloudAgentActivity(store: StoredCodingBuckets | null): Coverage[] {
  if (!store) return [];
  return mergeCoverage(store.windows.flatMap((window) => window.agents.some((row) => codingRowTokens(row) > 0)
    ? [{ from: window.from, to: Math.min(window.from + CODING_BUCKET_MS, store.receivedAt) }] : []));
}

function clip(parts: Coverage[], window: Coverage): Coverage[] {
  return parts.flatMap((part) => {
    const from = Math.max(window.from, part.from), to = Math.min(window.to, part.to);
    return to > from ? [{ from, to }] : [];
  });
}

export type CodingBandValue = 0 | 1 | 2 | 3;
export const CODING_AGENT_MAC = 1;
export const CODING_AGENT_CLOUD = 2;
export const CODING_AGENT_CURSOR = 4;
export type CodingBandSegment = { from: number; to: number; value: CodingBandValue; agentSources: number };

export function codingBand(observations: CodingObservation[], cursor: CursorObservation[], window: Coverage, cloudActivity: Coverage[] = []): CodingBandSegment[] {
  type Slice = Coverage & { human: boolean; agent: boolean };
  const mac: Slice[] = [];
  const sorted = [...observations].sort((a, b) => a.t - b.t);
  for (let i = 0; i < sorted.length; i++) {
    const observation = sorted[i];
    const from = Math.max(window.from, observation.t);
    const to = Math.min(window.to, observation.t + CODING_OBSERVATION_HOLD_MS, sorted[i + 1]?.t ?? window.to);
    if (to <= from || !observation.available) continue;
    mac.push({ from, to, human: observation.desktop?.coding ?? false, agent: observation.agents?.some((agent) => agent.active) ?? false });
  }
  const account = cursorWindowFeatures([...cursor].sort((a, b) => a.t - b.t), window);
  const cloud = clip(mergeCoverage(cloudActivity), window);
  const edges = [...new Set([...mac, ...account.coverage, ...account.activeCoverage, ...cloud].flatMap((part) => [part.from, part.to]))].sort((a, b) => a - b);
  const at = <T extends Coverage>(list: T[], cursorIndex: { i: number }, from: number, to: number): T | null => {
    while (cursorIndex.i < list.length && list[cursorIndex.i].to <= from) cursorIndex.i++;
    const part = list[cursorIndex.i];
    return part && part.from <= from && part.to >= to ? part : null;
  };
  const macAt = { i: 0 }, coveredAt = { i: 0 }, activeAt = { i: 0 }, cloudAt = { i: 0 };
  const segments: CodingBandSegment[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const from = edges[i], to = edges[i + 1];
    const slice = at(mac, macAt, from, to);
    const covered = at(account.coverage, coveredAt, from, to);
    const cursorActive = at(account.activeCoverage, activeAt, from, to);
    const cloudActive = at(cloud, cloudAt, from, to);
    if (!slice && !covered && !cloudActive) continue;
    const agents = (slice?.agent ? CODING_AGENT_MAC : 0) | (cloudActive ? CODING_AGENT_CLOUD : 0) | (cursorActive ? CODING_AGENT_CURSOR : 0);
    const value = ((slice?.human ? 1 : 0) + (agents ? 2 : 0)) as CodingBandValue;
    const previous = segments.at(-1);
    if (previous && previous.to === from && previous.value === value && previous.agentSources === agents) previous.to = to;
    else segments.push({ from, to, value, agentSources: agents });
  }
  return segments;
}
