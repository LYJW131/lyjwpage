import type { StoredCodingBuckets } from './coding-buckets';
import { CODING_BUCKET_MS, codingRowTokens } from './coding-usage';
import { cursorWindowFeatures, type CursorObservation } from './pulse-cursor';
import { mergeCoverage, type Coverage } from './pulse-features';
import type { CodingObservation, CodingWindowFeatures } from './pulse-coding';

export const CODING_WINDOW_MS = 5 * 60_000;
export const CODING_OBSERVATION_HOLD_MS = 3 * 60_000;

// 云端没有在线心跳，只有用量桶这一正证据：有用量的桶算 agent 在跑，没有桶是未知而非空闲。
export function cloudAgentActivity(store: StoredCodingBuckets | null): Coverage[] {
  if (!store) return [];
  // agents-otlp 里也有云端环境跑的 Devin CLI；cloudActiveSeconds 按提示词只数 Claude 的云端线程。
  return mergeCoverage(store.windows.flatMap((window) => window.agents.some((row) => row.id === "claude" && codingRowTokens(row) > 0)
    ? [{ from: window.from, to: Math.min(window.from + CODING_BUCKET_MS, store.receivedAt) }] : []));
}

function clip(parts: Coverage[], window: Coverage): Coverage[] {
  return parts.flatMap((part) => {
    const from = Math.max(window.from, part.from), to = Math.min(window.to, part.to);
    return to > from ? [{ from, to }] : [];
  });
}

export function codingWindowFeatures(observations: CodingObservation[], from: number, duration = CODING_WINDOW_MS, cursor: CursorObservation[] = [], cloudActivity: Coverage[] = []): CodingWindowFeatures {
  const to = from + duration;
  const result: CodingWindowFeatures = { from, to, coverage: [], observedSeconds: 0, unknownSeconds: duration / 1000,
    cursorObservedSeconds: 0, cursorActiveSeconds: 0, longestCursorRunSeconds: 0, cloudActiveSeconds: 0,
    desktopObservedSeconds: 0, agentObservedSeconds: 0, macAgentObservedSeconds: 0, codingAppSeconds: 0, agentActiveSeconds: 0, concurrentAgentSeconds: 0, codingAppAndAgentSeconds: 0,
    foregroundSwitches: 0, activityTransitions: 0, longestCodingRunSeconds: 0, applications: [], agents: [] };
  const agentCoverage: Coverage[] = [], agentActive: Coverage[] = [], codingActive: Coverage[] = [], concurrent: Coverage[] = [];
  let prior: { to: number; app: string | null; active: boolean } | null = null;
  for (let i = 0; i < observations.length; i++) {
    const observation = observations[i];
    const start = Math.max(from, observation.t);
    const end = Math.min(to, observation.t + CODING_OBSERVATION_HOLD_MS, observations[i + 1]?.t ?? to);
    if (end <= start || !observation.available) continue;
    const seconds = (end - start) / 1000;
    const last = result.coverage.at(-1);
    if (last?.to === start) last.to = end;
    else result.coverage.push({ from: start, to: end });
    result.observedSeconds += seconds;
    if (observation.desktop !== null) result.desktopObservedSeconds += seconds;
    if (observation.agents !== null) {
      result.macAgentObservedSeconds += seconds;
      agentCoverage.push({ from: start, to: end });
    }
    const activeAgents = observation.agents?.filter((agent) => agent.active) ?? [];
    const coding = observation.desktop?.coding ?? false;
    const active = coding || activeAgents.length > 0;
    if (coding) { result.codingAppSeconds += seconds; codingActive.push({ from: start, to: end }); }
    if (activeAgents.length) agentActive.push({ from: start, to: end });
    if (activeAgents.length > 1) concurrent.push({ from: start, to: end });
    if (prior?.to === start) {
      if (prior.app !== null && observation.desktop !== null && prior.app !== observation.desktop.application) result.foregroundSwitches++;
      if (prior.active !== active) result.activityTransitions++;
    }
    prior = { to: end, app: observation.desktop?.application ?? null, active };
    if (observation.desktop) {
      const app = result.applications.find((item) => item.name === observation.desktop!.application);
      if (app) app.seconds += seconds;
      else result.applications.push({ name: observation.desktop.application, coding, seconds });
    }
    for (const agent of activeAgents) {
      const entry = result.agents.find((item) => item.id === agent.id && item.model === agent.model);
      if (entry) entry.seconds += seconds;
      else result.agents.push({ id: agent.id, model: agent.model, seconds });
    }
  }
  const account = cursorWindowFeatures(cursor, { from, to });
  // 独立来源可能重叠，先取覆盖并集，避免把同一段时间累计两次。
  const union = (parts: Coverage[]) => mergeCoverage(parts.map((part) => ({ ...part })));
  const seconds = (parts: Coverage[]) => parts.reduce((sum, part) => sum + (part.to - part.from) / 1000, 0);
  const overlap = (left: Coverage[], right: Coverage[]) => left.flatMap((a) => right.flatMap((b) => {
    const from = Math.max(a.from, b.from), to = Math.min(a.to, b.to);
    return to > from ? [{ from, to }] : [];
  }));
  const cloud = clip(mergeCoverage(cloudActivity), { from, to });
  const allAgents = union([...agentActive, ...account.activeCoverage, ...cloud]);
  const allActivity = union([...codingActive, ...allAgents]);
  result.agentObservedSeconds = seconds(union([...agentCoverage, ...account.coverage, ...cloud]));
  result.agentActiveSeconds = seconds(allAgents);
  result.concurrentAgentSeconds = seconds(union([...concurrent, ...overlap(agentActive, account.activeCoverage),
    ...overlap(union([...agentActive, ...account.activeCoverage]), cloud)]));
  result.codingAppAndAgentSeconds = seconds(union(overlap(codingActive, allAgents)));
  result.longestCodingRunSeconds = Math.max(0, ...allActivity.map((part) => (part.to - part.from) / 1000));
  if (account.cursorActiveSeconds > 0) result.agents.push({ id: 'cursor', model: null, seconds: account.cursorActiveSeconds });
  result.cloudActiveSeconds = seconds(cloud);
  if (result.cloudActiveSeconds > 0) result.agents.push({ id: 'claude-cloud', model: null, seconds: result.cloudActiveSeconds });
  result.cursorObservedSeconds = account.cursorObservedSeconds;
  result.cursorActiveSeconds = account.cursorActiveSeconds;
  result.longestCursorRunSeconds = account.longestCursorRunSeconds;
  result.coverage = mergeCoverage([...result.coverage, ...account.coverage, ...cloud]);
  result.observedSeconds = result.coverage.reduce((sum, part) => sum + (part.to - part.from) / 1000, 0);
  result.unknownSeconds = duration / 1000 - result.observedSeconds;
  result.applications.sort((a, b) => b.seconds - a.seconds);
  result.applications = result.applications.slice(0, 8);
  result.agents.sort((a, b) => b.seconds - a.seconds);
  result.agents = result.agents.slice(0, 8);
  return result;
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
