import { PULSE_TTL_MS, PULSE_WINDOW_MS } from '@/lib/limits';
import { CODING_WINDOW_MS, PULSE_SCORE_WINDOW_MS, codingQuestions, codingWindowFeatures, judgment, modeJudgment, parseCodingObservation } from '@shared/pulse-coding';
import { parseCursorObservation } from '@shared/pulse-cursor';
import { parseStoredCodingBuckets, type StoredCodingBuckets } from '@shared/coding-buckets';
import type { CodingTokenBucketRow } from '@shared/coding-usage';
import { CODING_USAGE_SOURCE_NAMES, type CodingUsageSource } from '@shared/coding-usage-sources';
import { PULSE_ASSESSMENT_VERSION, latestPulseAssessments, type PulseAssessment, type PulseScoredDomain } from '@shared/pulse-assessment';
import type { ChoiceQuestion, Coverage, PulseQuestion, ScoreQuestion } from '@shared/pulse-features';
import type { PulseScoreCoordinator } from './pulse-score-state';

/**
 * Jev 只给 Coding 打分：别的道画的是事实时间线（状态区间、实测瓦数、步数），
 * 事实本身就是答案，不再需要模型去猜强度。Coding 的原始观测说得出「前台是不是
 * coding 应用、agent 在不在跑」，说不出「写得多投入」，强度和模式仍问 Jev，
 * 只在悬停提示里出现。
 */
type Built = { state: unknown; coverage: Coverage[]; questions: Record<string, PulseQuestion>; ids: { intensity: string; continuity: string; mode: string } };
/** 没问 Jev 时记在已有 model 字段上。置信度仍用答案里的 confidence，不另加字段。 */
const PULSE_RULE_MODEL = "rules";
const TOKEN_COUNT_KEYS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "reasoningTokens"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function num(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
/** 一行 token 证据是不是零：token 各列都是 0，事件数是 0 或数不出来 */
function zeroTokens(value: unknown): boolean {
  const counts = record(value);
  if (!counts || !TOKEN_COUNT_KEYS.every((key) => num(counts, key) === 0)) return false;
  return counts.eventCount === null || num(counts, "eventCount") === 0;
}
/** 覆盖区间首尾相接铺满整个评分窗。缺口不算 0。 */
function covers(coverage: Coverage[], from: number, to: number): boolean {
  let cursor = from;
  for (const part of coverage) {
    if (part.from > cursor) return false;
    cursor = Math.max(cursor, part.to);
  }
  return cursor >= to;
}
function codingZero(state: unknown): boolean {
  const row = record(state);
  const facts = row && Array.isArray(row.windows) ? record(row.windows[0]) : null;
  const observed = facts ? num(facts, "observedSeconds") : null;
  if (!facts || observed == null || observed <= 0) return false;
  if (num(facts, "desktopObservedSeconds") !== observed || num(facts, "macAgentObservedSeconds") !== observed) return false;
  if (num(facts, "cursorActiveSeconds") !== 0) return false;
  if (num(facts, "codingAppSeconds") !== 0 || num(facts, "agentActiveSeconds") !== 0 || num(facts, "longestCodingRunSeconds") !== 0) return false;
  if (!Array.isArray(facts.agents) || facts.agents.length !== 0) return false;
  const usage = record(facts.tokenUsage);
  const buckets = PULSE_SCORE_WINDOW_MS / CODING_WINDOW_MS;
  if (!usage || num(usage, "observedBucketCount") !== buckets || num(usage, "unknownBucketCount") !== 0) return false;
  // 「确定为零」只认 Mac 本机扫描的完整覆盖；账号与云端的桶只作正证据
  const mac = Array.isArray(usage.sources) ? usage.sources.filter((source) => record(source)?.source === "mac") : [];
  if (mac.length === 0 || !mac.every((source) => record(source)?.state === "ok")) return false;
  return Array.isArray(usage.agents) && usage.agents.every(zeroTokens);
}
/** 这一窗被观测到，而且证据就是零活动。缺报、未知、覆盖不全都不是 0。 */
function definiteZero(state: unknown, coverage: Coverage[], from: number): boolean {
  return covers(coverage, from, from + PULSE_SCORE_WINDOW_MS) && codingZero(state);
}
/** No activity in the available account source, with the live source absent.
 * This is an inferred baseline with limited confidence, never measured silence.
 */
function quietIndependentSource(state: unknown): boolean {
  const row = record(state);
  if (!row || !Array.isArray(row.windows)) return false;
  const facts = record(row.windows[0]);
  if (!facts || num(facts, "desktopObservedSeconds") !== 0 || num(facts, "macAgentObservedSeconds") !== 0
    || (num(facts, "cursorObservedSeconds") ?? 0) <= 0 || num(facts, "cursorActiveSeconds") !== 0) return false;
  const usage = record(facts.tokenUsage);
  return !usage || (Array.isArray(usage.agents) && usage.agents.every(zeroTokens));
}
/** The baseline is conditional on the observed sources; confidence records completeness. */
function baselineScore(question: ScoreQuestion, confidence: number) {
  const probabilities = Object.fromEntries(question.criteria.map((_, index) => [String(index), index === 0 ? 1 : 0]));
  return judgment({ type: "score", score: 0, confidence, probabilities }, question.criteria.length, true);
}
function baselineIdle(question: ChoiceQuestion, confidence: number) {
  if (!Object.hasOwn(question.criteria, "idle")) throw new Error("Missing idle choice");
  const probabilities = Object.fromEntries(Object.keys(question.criteria).map((key) => [key, key === "idle" ? 1 : 0]));
  return modeJudgment({ type: "choice", choice: "idle", confidence, probabilities }, true);
}

type TokenEvidence = CodingTokenBucketRow & { source: CodingUsageSource };

/**
 * 一个评分窗里各来源的 token 证据。
 *
 * Mac 本机扫描报的是一段范围里的全部桶：范围内缺席的桶是测到的 0，范围外是未知 ——
 * `observedBucketCount` 只数被 Mac 覆盖完整的桶，Mac 的行也只取这些桶里的。Cursor 账号
 * 历史与云端 OTLP 的桶只作正证据：有行就算，没行不代表 0。按 (来源, agent, 模型) 相加，
 * 事件数数不出来（OTLP）的行不加进事件数，全都数不出来就是 null。
 */
function windowTokenUsage(buckets: Record<CodingUsageSource, StoredCodingBuckets | null>, from: number) {
  const starts = Array.from({ length: PULSE_SCORE_WINDOW_MS / CODING_WINDOW_MS }, (_, i) => from + i * CODING_WINDOW_MS);
  const mac = buckets.mac;
  const covered = mac ? starts.filter((bucket) => mac.coverage.some((part) => part.from <= bucket && bucket + CODING_WINDOW_MS <= part.to)) : [];
  const rows: TokenEvidence[] = [];
  for (const source of CODING_USAGE_SOURCE_NAMES) {
    for (const window of buckets[source]?.windows ?? []) {
      if (!starts.includes(window.from) || (source === "mac" && !covered.includes(window.from))) continue;
      rows.push(...window.agents.map((agent) => ({ source, ...agent })));
    }
  }
  if (!covered.length && !rows.length) return null;
  const summed = new Map<string, TokenEvidence>();
  for (const row of rows) {
    const key = JSON.stringify([row.source, row.id, row.model]);
    const prior = summed.get(key);
    summed.set(key, prior ? {
      ...prior,
      inputTokens: prior.inputTokens + row.inputTokens,
      outputTokens: prior.outputTokens + row.outputTokens,
      cacheReadTokens: prior.cacheReadTokens + row.cacheReadTokens,
      cacheCreationTokens: prior.cacheCreationTokens + row.cacheCreationTokens,
      reasoningTokens: prior.reasoningTokens + row.reasoningTokens,
      eventCount: prior.eventCount == null ? row.eventCount : row.eventCount == null ? prior.eventCount : prior.eventCount + row.eventCount,
    } : { ...row });
  }
  return {
    sources: CODING_USAGE_SOURCE_NAMES.flatMap((source) => (buckets[source]?.agents ?? []).map((agent) => ({ source, id: agent.id, state: agent.state }))),
    observedBucketCount: covered.length,
    unknownBucketCount: starts.length - covered.length,
    agents: [...summed.values()],
  };
}

/** One scheduler, one set of assessments: summaries are derived, never a second model call. */
export class PulseScorer {
  private options: { coordinator: PulseScoreCoordinator; apiKey: string; fetch?: typeof fetch; log?: (error: unknown) => void };
  constructor(options: PulseScorer['options']) { this.options = options; }
  async run(): Promise<void> {
    try { await this.tick(); } catch (e) { this.log(e); }
  }
  private log(e: unknown) { (this.options.log ?? ((e)=>console.error('[pulse-score]',e instanceof Error ? e.message : String(e))))(e); }
  private async tick() {
    const claim = await this.options.coordinator.claimPulseScore();
    if (!claim) return;
    try {
      const { now, inputs } = claim;
      const cursor = inputs.cursorObservations.map(parseCursorObservation).filter((row) => row !== null).sort((a, b) => a.t - b.t);
      const existing = latestPulseAssessments(inputs.assessments).filter((r)=>r.to>now-PULSE_TTL_MS);
      const completed = new Map(existing.map((r)=>[`${r.domain}:${r.from}`,r]));
      const seen = inputs.codingObservations.map(parseCodingObservation).filter((r)=>r!==null).sort((a,b)=>a.t-b.t);
      const buckets = Object.fromEntries(CODING_USAGE_SOURCE_NAMES.map((source) => [source, parseStoredCodingBuckets(inputs.tokenBuckets?.[source] ?? null)])) as Record<CodingUsageSource, StoredCodingBuckets | null>;
      const domain: PulseScoredDomain = 'coding';
      // Two-minute settling time allows the one-minute usage scan and transport to finish.
      const end = Math.floor((now-120_000)/PULSE_SCORE_WINDOW_MS)*PULSE_SCORE_WINDOW_MS;
      const jobs: {domain: PulseScoredDomain; from: number; coverage: Coverage[]; state: unknown; questions: Record<string, PulseQuestion>; ids: Built['ids']; hash:string}[] = [];
      const ruled: PulseAssessment[] = [];
      for (let from=end-PULSE_SCORE_WINDOW_MS;from>=Math.ceil((now-PULSE_WINDOW_MS)/PULSE_SCORE_WINDOW_MS)*PULSE_SCORE_WINDOW_MS&&jobs.length<36;from-=PULSE_SCORE_WINDOW_MS) {
        const facts=codingWindowFeatures(seen,from,PULSE_SCORE_WINDOW_MS,cursor);
        const tokens = windowTokenUsage(buckets, from);
        const built: Built={state:{windows:[{...facts,tokenUsage:tokens}]},coverage:facts.coverage,questions:codingQuestions([facts]) as Record<string, PulseQuestion>,ids:{intensity:'w0Intensity',continuity:'w0Continuity',mode:'w0Mode'}};
        if (!built.coverage.length) continue;
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({version:PULSE_ASSESSMENT_VERSION,state:built.state,questions:built.questions})));
        const hash=Array.from(new Uint8Array(digest),(b)=>b.toString(16).padStart(2,'0')).join('');
        if(completed.get(`${domain}:${from}`)?.inputHash===hash) continue;
        const limitedZero = quietIndependentSource(built.state);
        if (definiteZero(built.state, built.coverage, from) || limitedZero) {
          const confidence = limitedZero ? 0.5 : 1;
          const intensity = built.questions[built.ids.intensity];
          const continuity = built.questions[built.ids.continuity];
          const modeQuestion = built.questions[built.ids.mode];
          if (intensity?.type === "score" && continuity?.type === "score" && modeQuestion?.type === "choice") {
            ruled.push({ from, to: from + PULSE_SCORE_WINDOW_MS, coverage: built.coverage,
              intensity: baselineScore(intensity, confidence), continuity: baselineScore(continuity, confidence),
              mode: baselineIdle(modeQuestion, confidence),
              model: limitedZero ? "rules:limited-source" : PULSE_RULE_MODEL, scoredAt: now, domain, inputHash: hash });
            continue;
          }
        }
        jobs.push({domain,from,coverage:built.coverage,state:built.state,questions:built.questions,ids:built.ids,hash});
      }
      if(!jobs.length && !ruled.length) {
        await this.options.coordinator.finishPulseScore(claim.token, claim.generation, []);
        return;
      }
      if (!await this.options.coordinator.activatePulseScore(claim.token, claim.generation)) return;
      const records: PulseAssessment[]=[...ruled];
      for(let i=0;i<jobs.length;i+=3){
        const results=await Promise.allSettled(jobs.slice(i,i+3).map(async(job)=>{
          const response=await(this.options.fetch??fetch)('https://api.typesafe.ai/v1/systemone',{
            method:'POST',headers:{Authorization:`Bearer ${this.options.apiKey}`,'Content-Type':'application/json'},
            body:JSON.stringify({model:'jev-1.13.0',state:job.state,questions:job.questions}),signal:AbortSignal.timeout(10_000)});
          if(!response.ok)throw Error(`Jev HTTP ${response.status}`);
          const body=await response.json() as {model:string;answers:Record<string,unknown>};
          if (typeof body.model !== 'string' || !body.model || !body.answers) throw Error('Invalid Jev response');
          return {from:job.from,to:job.from+PULSE_SCORE_WINDOW_MS,coverage:job.coverage,
            intensity:judgment(body.answers[job.ids.intensity],5,true),continuity:judgment(body.answers[job.ids.continuity],4,true),
            mode:modeJudgment(body.answers[job.ids.mode],true),
            model:body.model,scoredAt:now,domain:job.domain,inputHash:job.hash};
        }));
        for(const result of results)if(result.status==='fulfilled')records.push(result.value);else this.log(result.reason);
      }
      await this.options.coordinator.finishPulseScore(claim.token, claim.generation, records);
    } catch (error) {
      try { await this.options.coordinator.finishPulseScore(claim.token, claim.generation, []); }
      catch (releaseError) { this.log(releaseError); }
      throw error;
    }
  }
}
