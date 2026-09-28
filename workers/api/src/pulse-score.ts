import { PULSE_TTL_MS, PULSE_WINDOW_MS } from '@/lib/limits';
import { CODING_WINDOW_MS, PULSE_SCORE_WINDOW_MS, codingQuestions, codingWindowFeatures, judgment, modeJudgment, parseCodingObservation } from '@shared/pulse-coding';
import { parseCursorObservation } from '@shared/pulse-cursor';
import { parseCodingTokenUsage } from '@shared/coding-token-usage';
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
const TOKEN_COUNT_KEYS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "reasoningTokens", "eventCount"] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function num(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
  if (!Array.isArray(usage.sources) || usage.sources.length === 0 || !usage.sources.every((source) => record(source)?.state === "ok")) return false;
  return Array.isArray(usage.agents) && usage.agents.every((agent) => {
    const counts = record(agent);
    return counts != null && TOKEN_COUNT_KEYS.every((key) => num(counts, key) === 0);
  });
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
  return !usage || (Array.isArray(usage.agents) && usage.agents.every((agent) => {
    const counts = record(agent);
    return counts != null && TOKEN_COUNT_KEYS.every((key) => num(counts, key) === 0);
  }));
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
      const tokenUsage = inputs.codingTokenUsage ? parseCodingTokenUsage(JSON.parse(inputs.codingTokenUsage)) : null;
      const domain: PulseScoredDomain = 'coding';
      // Two-minute settling time allows the one-minute usage scan and transport to finish.
      const end = Math.floor((now-120_000)/PULSE_SCORE_WINDOW_MS)*PULSE_SCORE_WINDOW_MS;
      const jobs: {domain: PulseScoredDomain; from: number; coverage: Coverage[]; state: unknown; questions: Record<string, PulseQuestion>; ids: Built['ids']; hash:string}[] = [];
      const ruled: PulseAssessment[] = [];
      for (let from=end-PULSE_SCORE_WINDOW_MS;from>=Math.ceil((now-PULSE_WINDOW_MS)/PULSE_SCORE_WINDOW_MS)*PULSE_SCORE_WINDOW_MS&&jobs.length<36;from-=PULSE_SCORE_WINDOW_MS) {
        const facts=codingWindowFeatures(seen,from,PULSE_SCORE_WINDOW_MS,cursor);
        // The producer emits only buckets with events. An absent bucket inside its
        // reported range is measured zero; outside that range it is unknown.
        const coveredBuckets = tokenUsage ? Array.from({length: 3}, (_, i) => from + i * CODING_WINDOW_MS)
          .filter((bucket) => bucket >= tokenUsage.from && bucket + CODING_WINDOW_MS <= tokenUsage.to) : [];
        const usageWindows = tokenUsage?.windows.filter((w) => coveredBuckets.includes(w.from)) ?? [];
        const tokens = tokenUsage && coveredBuckets.length ? {
          sources: tokenUsage.sources,
          observedBucketCount: coveredBuckets.length,
          unknownBucketCount: 3 - coveredBuckets.length,
          agents: Object.values(usageWindows.flatMap((w) => w.agents).reduce<Record<string, typeof usageWindows[number]['agents'][number]>>((all, agent) => {
            const key = JSON.stringify([agent.id, agent.model]);
            const prior = all[key];
            all[key] = prior ? { ...agent, inputTokens: prior.inputTokens + agent.inputTokens, outputTokens: prior.outputTokens + agent.outputTokens,
              cacheReadTokens: prior.cacheReadTokens + agent.cacheReadTokens, cacheCreationTokens: prior.cacheCreationTokens + agent.cacheCreationTokens,
              reasoningTokens: prior.reasoningTokens + agent.reasoningTokens, eventCount: prior.eventCount + agent.eventCount } : { ...agent };
            return all;
          }, {})),
        } : null;
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
