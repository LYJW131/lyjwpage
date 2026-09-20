import { key, withStorage } from '@/lib/storage';
import { parsePulseAssessment, type PulseAssessment } from '@shared/pulse-assessment';
export const pulseAssessmentsKey = () => key('pulse','assessments');
export const pulseAssessmentAttemptKey = () => key('pulse','assessment-attempt');
export async function readPulseAssessments(from: number, to: number): Promise<PulseAssessment[]> {
  const rows = await withStorage((s)=>s.listRange(pulseAssessmentsKey(),0,-1),[] as string[]);
  return rows.map(parsePulseAssessment).filter((r): r is PulseAssessment=>r!==null&&r.to>from&&r.from<to).sort((a,b)=>a.from-b.from);
}
