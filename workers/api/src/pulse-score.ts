import { parsePulseSample, pulseSampleUntil } from '@/lib/pulse';
import { PULSE_DOMAINS, type PulseDomain, type PulseSample } from '@/lib/types';
import { PULSE_TTL_MS, PULSE_WINDOW_MS } from '@/lib/limits';
import { CODING_WINDOW_MS, PULSE_SCORE_WINDOW_MS, codingQuestions, codingWindowFeatures, judgment, parseCodingObservation } from '@shared/pulse-coding';
import { parseCodingTokenUsage } from '@shared/coding-token-usage';
import { PULSE_ASSESSMENT_VERSION, PULSE_MODES, latestPulseAssessments, type PulseAssessment, type PulseMode } from '@shared/pulse-assessment';
import { activityQuestions, activityWindowFeatures, parseActivityWorkouts, type ActivityWorkout } from '@shared/pulse-activity';
import { chargingQuestions, chargingWindowFeatures } from '@shared/pulse-charging';
import type { ChoiceQuestion, Coverage, PulseQuestion, ScoreQuestion } from '@shared/pulse-features';
import { gamingQuestions, gamingWindowFeatures } from '@shared/pulse-gaming';
import { listeningQuestions, listeningWindowFeatures, parseListeningPlay, type ListeningPlay } from '@shared/pulse-listening';
import { watchingQuestions, watchingWindowFeatures } from '@shared/pulse-watching';
import type { PulseScoreCoordinator } from './pulse-score-state';

/**
 * 五个实测域各自把窗口压成命名特征（秒数、次数、前几个名字），问题也各自写。
 * state 直接就是特征对象——一次请求一个窗口，不再套 windows[0] 多一跳。
 * 返回的 questions 用 intensity / continuity / mode 做 id；coding 沿用它的 w0*。
 */
type Built = { state: unknown; coverage: Coverage[]; questions: Record<string, PulseQuestion>; ids: { intensity: string; continuity: string; mode: string | null } };
function buildMeasured(domain: Exclude<PulseDomain, 'coding'>, samples: PulseSample[], window: Coverage, plays: ListeningPlay[], workouts: ActivityWorkout[]): Built {
  const ids = { intensity: 'intensity', continuity: 'continuity', mode: null as string | null };
  switch (domain) {
    case 'listening': { const { features, coverage } = listeningWindowFeatures(samples, window, plays); return { state: features, coverage, questions: listeningQuestions(), ids: { ...ids, mode: 'mode' } }; }
    case 'watching': { const { features, coverage } = watchingWindowFeatures(samples, window); return { state: features, coverage, questions: watchingQuestions(), ids }; }
    case 'gaming': { const { features, coverage } = gamingWindowFeatures(samples, window); return { state: features, coverage, questions: gamingQuestions(), ids }; }
    case 'charging': { const { features, coverage } = chargingWindowFeatures(samples, window); return { state: features, coverage, questions: chargingQuestions(), ids }; }
    case 'activity': { const { features, coverage } = activityWindowFeatures(samples, window, workouts); return { state: features, coverage, questions: activityQuestions(), ids }; }
  }
}
/** Choice 答案按该域的模式集合校验，形状同 pulse-coding 的 modeJudgment。 */
function modeAnswer(raw: unknown, domain: PulseDomain): PulseMode {
  const modes = PULSE_MODES[domain];
  const row = raw as { type?: unknown; choice?: unknown; confidence?: unknown; probabilities?: Record<string, unknown> };
  if (!modes || row.type !== 'choice' || typeof row.choice !== 'string' || !modes.includes(row.choice)) throw Error('Invalid mode');
  const probabilities = Object.fromEntries(modes.map((key) => { const p = row.probabilities?.[key]; if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) throw Error('Invalid mode probability'); return [key, p]; }));
  if (typeof row.confidence !== 'number' || row.confidence < 0 || row.confidence > 1 || Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) > 0.01) throw Error('Invalid mode distribution');
  return { value: row.choice, confidence: row.confidence, probabilities };
}

const SCORED_DOMAINS = PULSE_DOMAINS;
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
function measuredZero(domain: Exclude<PulseDomain, "coding">, state: unknown): boolean {
  const row = record(state);
  const observed = row ? num(row, "observedSeconds") : null;
  if (!row || observed == null || observed <= 0) return false;
  const zero = (key: string) => num(row, key) === 0;
  switch (domain) {
    case "listening":
      return zero("playingSeconds") && zero("pausedSeconds") && num(row, "idleSeconds") === observed
        && Array.isArray(row.recentPlays) && row.recentPlays.length === 0;
    case "watching":
      return zero("playingSeconds") && zero("pausedSeconds") && num(row, "idleSeconds") === observed;
    case "gaming":
      return zero("inGameSeconds") && zero("onlineIdleSeconds") && num(row, "offlineSeconds") === observed;
    case "charging": {
      const bands = record(row.secondsByBand);
      return row.peakWatts === 0 && bands != null && num(bands, "unplugged") === observed
        && num(bands, "trickle") === 0 && num(bands, "moderate") === 0 && num(bands, "high") === 0;
    }
    case "activity":
      return num(row, "stillSeconds") === observed && zero("lightSeconds") && zero("moderateSeconds")
        && zero("vigorousSeconds") && zero("workoutSeconds") && Array.isArray(row.workouts) && row.workouts.length === 0;
  }
}
function codingZero(state: unknown): boolean {
  const row = record(state);
  const facts = row && Array.isArray(row.windows) ? record(row.windows[0]) : null;
  const observed = facts ? num(facts, "observedSeconds") : null;
  if (!facts || observed == null || observed <= 0) return false;
  if (num(facts, "desktopObservedSeconds") !== observed || num(facts, "agentObservedSeconds") !== observed) return false;
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
/**
 * 这一窗被观测到，而且证据就是零活动。缺报、未知、覆盖不全都不是 0。
 * activity 的缺口是未知；charging 的 0 瓦必须是实测峰值，没有瓦数不算。
 */
function definiteZero(domain: PulseDomain, state: unknown, coverage: Coverage[], from: number): boolean {
  if (!covers(coverage, from, from + PULSE_SCORE_WINDOW_MS)) return false;
  return domain === "coding" ? codingZero(state) : measuredZero(domain, state);
}
/** 题目最低档，置信度取确定（1）且概率全部落在这一档。走现有 judgment / modeAnswer。 */
function certainScore(question: ScoreQuestion) {
  const probabilities = Object.fromEntries(question.criteria.map((_, index) => [String(index), index === 0 ? 1 : 0]));
  return judgment({ type: "score", score: 0, confidence: 1, probabilities }, question.criteria.length, true);
}
function certainIdle(question: ChoiceQuestion, domain: PulseDomain): PulseMode {
  const modes = PULSE_MODES[domain];
  if (!modes?.includes("idle") || !Object.hasOwn(question.criteria, "idle")) throw new Error("Missing idle choice");
  const probabilities = Object.fromEntries(modes.map((key) => [key, key === "idle" ? 1 : 0]));
  return modeAnswer({ type: "choice", choice: "idle", confidence: 1, probabilities }, domain);
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
      const raw = inputs.assessments;
      const observations = inputs.codingObservations;
      const tokenRaw = inputs.codingTokenUsage;
      const playRows = inputs.listeningPlays;
      const workouts = parseActivityWorkouts(inputs.workouts);
      const histories = SCORED_DOMAINS.map((domain) => inputs.histories[domain]);
      const existing = latestPulseAssessments(raw).filter((r)=>r.to>now-PULSE_TTL_MS);
      const completed = new Map(existing.map((r)=>[`${r.domain}:${r.from}`,r]));
      const seen = observations.map(parseCodingObservation).filter((r)=>r!==null).sort((a,b)=>a.t-b.t);
      const tokenUsage = tokenRaw ? parseCodingTokenUsage(JSON.parse(tokenRaw)) : null;
      // 「最近在听」列表变动：没有时刻的播放痕迹，只给 listening 当证据用。
      const plays = playRows.map(parseListeningPlay).filter((r)=>r!==null).sort((a,b)=>a.t-b.t);
      const series = histories.map((rows, index)=>rows.map(parsePulseSample).filter((r)=>r!==null).map((r)=>({...r,until:Math.min(now, pulseSampleUntil(SCORED_DOMAINS[index], r))})));
      // Two-minute settling time allows the one-minute usage scan and transport to finish.
      const end = Math.floor((now-120_000)/PULSE_SCORE_WINDOW_MS)*PULSE_SCORE_WINDOW_MS;
      const jobs: {domain: PulseDomain; from: number; coverage: Coverage[]; state: unknown; questions: Record<string, PulseQuestion>; ids: Built['ids']; hash:string}[] = [];
      const ruled: PulseAssessment[] = [];
      for (let from=end-PULSE_SCORE_WINDOW_MS;from>=Math.ceil((now-PULSE_WINDOW_MS)/PULSE_SCORE_WINDOW_MS)*PULSE_SCORE_WINDOW_MS&&jobs.length<36;from-=PULSE_SCORE_WINDOW_MS) {
        for (const [index,domain] of SCORED_DOMAINS.entries()) {
          if (jobs.length>=36) break;
          const window = {from,to:from+PULSE_SCORE_WINDOW_MS};
          let built: Built;
          if (domain==='coding') {
            const facts=codingWindowFeatures(seen,from,PULSE_SCORE_WINDOW_MS);
            // The producer emits only buckets with events. An absent bucket inside its
            // reported range is measured zero; outside that range it is unknown.
            const coveredBuckets = tokenUsage ? Array.from({length: 3}, (_, i) => from + i * 300_000)
              .filter((bucket) => bucket >= tokenUsage.from && bucket + 300_000 <= tokenUsage.to) : [];
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
            built={state:{windows:[{...facts,tokenUsage:tokens}]},coverage:facts.coverage,questions:codingQuestions([facts]) as Record<string, PulseQuestion>,ids:{intensity:'w0Intensity',continuity:'w0Continuity',mode:'w0Mode'}};
          } else {
            built=buildMeasured(domain, series[index], window, plays, workouts);
          }
          if (!built.coverage.length) continue;
          const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({version:PULSE_ASSESSMENT_VERSION,state:built.state,questions:built.questions})));
          const hash=Array.from(new Uint8Array(digest),(b)=>b.toString(16).padStart(2,'0')).join('');
          if(completed.get(`${domain}:${from}`)?.inputHash===hash) continue;
          if (definiteZero(domain, built.state, built.coverage, from)) {
            const intensity = built.questions[built.ids.intensity];
            const continuity = built.questions[built.ids.continuity];
            const modeQuestion = built.ids.mode ? built.questions[built.ids.mode] : null;
            const modeReady = built.ids.mode == null || modeQuestion?.type === "choice";
            if (intensity?.type === "score" && continuity?.type === "score" && modeReady) {
              ruled.push({ from, to: from + PULSE_SCORE_WINDOW_MS, coverage: built.coverage,
                intensity: certainScore(intensity), continuity: certainScore(continuity),
                mode: modeQuestion?.type === "choice" ? certainIdle(modeQuestion, domain) : null,
                model: PULSE_RULE_MODEL, scoredAt: now, domain, inputHash: hash });
              continue;
            }
          }
          jobs.push({domain,from,coverage:built.coverage,state:built.state,questions:built.questions,ids:built.ids,hash});
        }
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
            mode:job.ids.mode?modeAnswer(body.answers[job.ids.mode],job.domain):null,
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
