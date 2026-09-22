import { parsePulseSample, pulseSampleUntil } from '@/lib/pulse';
import { PULSE_DOMAINS, type PulseDomain, type PulseSample } from '@/lib/types';
import { PULSE_TTL_MS, PULSE_WINDOW_MS } from '@/lib/limits';
import { CODING_WINDOW_MS, codingQuestions, codingWindowFeatures, judgment, parseCodingObservation } from '@shared/pulse-coding';
import { parseCodingTokenUsage } from '@shared/coding-token-usage';
import { PULSE_ASSESSMENT_VERSION, PULSE_MODES, parsePulseAssessment, type PulseAssessment, type PulseMode } from '@shared/pulse-assessment';
import { activityQuestions, activityWindowFeatures, parseActivityWorkouts, type ActivityWorkout } from '@shared/pulse-activity';
import { chargingQuestions, chargingWindowFeatures } from '@shared/pulse-charging';
import type { Coverage, PulseQuestion } from '@shared/pulse-features';
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
      const existing = raw.map(parsePulseAssessment).filter((r): r is PulseAssessment=>r!==null&&r.to>now-PULSE_TTL_MS);
      const completed = new Map(existing.map((r)=>[`${r.domain}:${r.from}`,r]));
      const seen = observations.map(parseCodingObservation).filter((r)=>r!==null).sort((a,b)=>a.t-b.t);
      const tokenUsage = tokenRaw ? parseCodingTokenUsage(JSON.parse(tokenRaw)) : null;
      // 「最近在听」列表变动：没有时刻的播放痕迹，只给 listening 当证据用。
      const plays = playRows.map(parseListeningPlay).filter((r)=>r!==null).sort((a,b)=>a.t-b.t);
      const series = histories.map((rows, index)=>rows.map(parsePulseSample).filter((r)=>r!==null).map((r)=>({...r,until:Math.min(now, pulseSampleUntil(SCORED_DOMAINS[index], r))})));
      // Two-minute settling time allows the one-minute usage scan and transport to finish.
      const end = Math.floor((now-120_000)/CODING_WINDOW_MS)*CODING_WINDOW_MS;
      const jobs: {domain: PulseDomain; from: number; coverage: Coverage[]; state: unknown; questions: Record<string, PulseQuestion>; ids: Built['ids']; hash:string}[] = [];
      for (let from=end-CODING_WINDOW_MS;from>=Math.ceil((now-PULSE_WINDOW_MS)/CODING_WINDOW_MS)*CODING_WINDOW_MS&&jobs.length<36;from-=CODING_WINDOW_MS) {
        for (const [index,domain] of SCORED_DOMAINS.entries()) {
          if (jobs.length>=36) break;
          const window = {from,to:from+CODING_WINDOW_MS};
          let built: Built;
          if (domain==='coding') {
            const facts=codingWindowFeatures(seen,from);
            const validUsage=tokenUsage&&tokenUsage.from<=from&&tokenUsage.to>=window.to;
            const tokens=validUsage?{sources:tokenUsage.sources,agents:tokenUsage.windows.find((w)=>w.from===from)?.agents??[]}:null;
            built={state:{windows:[{...facts,tokenUsage:tokens}]},coverage:facts.coverage,questions:codingQuestions([facts]) as Record<string, PulseQuestion>,ids:{intensity:'w0Intensity',continuity:'w0Continuity',mode:'w0Mode'}};
          } else {
            built=buildMeasured(domain, series[index], window, plays, workouts);
          }
          if (!built.coverage.length) continue;
          const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({version:PULSE_ASSESSMENT_VERSION,state:built.state,questions:built.questions})));
          const hash=Array.from(new Uint8Array(digest),(b)=>b.toString(16).padStart(2,'0')).join('');
          if(completed.get(`${domain}:${from}`)?.inputHash===hash) continue;
          jobs.push({domain,from,coverage:built.coverage,state:built.state,questions:built.questions,ids:built.ids,hash});
        }
      }
      if(!jobs.length) {
        await this.options.coordinator.finishPulseScore(claim.token, claim.generation, []);
        return;
      }
      if (!await this.options.coordinator.activatePulseScore(claim.token, claim.generation)) return;
      const records: PulseAssessment[]=[];
      for(let i=0;i<jobs.length;i+=3){
        const results=await Promise.allSettled(jobs.slice(i,i+3).map(async(job)=>{
          const response=await(this.options.fetch??fetch)('https://api.typesafe.ai/v1/systemone',{
            method:'POST',headers:{Authorization:`Bearer ${this.options.apiKey}`,'Content-Type':'application/json'},
            body:JSON.stringify({model:'jev-1.13.0',state:job.state,questions:job.questions}),signal:AbortSignal.timeout(10_000)});
          if(!response.ok)throw Error(`Jev HTTP ${response.status}`);
          const body=await response.json() as {model:string;answers:Record<string,unknown>};
          if (typeof body.model !== 'string' || !body.model || !body.answers) throw Error('Invalid Jev response');
          return {from:job.from,to:job.from+CODING_WINDOW_MS,coverage:job.coverage,
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
