import { readFileSync } from "node:fs";
import { codingQuestions, codingWindowFeatures, type CodingObservation } from "@shared/pulse-coding";

const local = (() => { try { return readFileSync(".env.local", "utf8"); } catch { return ""; } })();
const env = (name: string) => process.env[name] || local.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1]?.trim();
const account = env("CLOUDFLARE_ACCOUNT_ID"), token = env("CLOUDFLARE_API_TOKEN");
if (!account || !token) throw new Error("need CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in env or .env.local");
const model = process.env.CLEF_PROBE_MODEL === "clef-flash" ? "clef-flash" : "clef";
const T = 1_800_000_000_000, M = 60_000, WINDOW = 5 * M;

type Case = { name: string; expect: string; state: unknown; questions: Record<string, unknown>; check?: (a: Answers) => boolean };
type Answer = { type: string; score?: number; choice?: string; confidence: number; probabilities: Record<string, number> };
type Answers = Record<string, Answer>;
const cases: Case[] = [];

function minutes(desktop: CodingObservation["desktop"], agents: CodingObservation["agents"]): CodingObservation[] {
  return Array.from({ length: 5 }, (_, i) => ({ t: T + i * M, available: true, desktop, agents }));
}
function add(name: string, expect: string, observations: CodingObservation[], cursor: Parameters<typeof codingWindowFeatures>[3] = [], check?: Case["check"]) {
  const facts = codingWindowFeatures(observations, T, WINDOW, cursor);
  cases.push({ name, expect, state: { windows: [{ ...facts, tokenUsage: null }] }, questions: codingQuestions([facts]), check });
}

add("coding · 整窗前台是编辑器，没有 agent", "intensity 3 · continuity 3 · interactive",
  minutes({ application: "Cursor", coding: true }, [{ id: "claude", model: "claude-opus", active: false }]));
add("coding · 前台是浏览器，agent 一直在跑", "intensity 3 · continuity 3 · agent",
  minutes({ application: "Safari", coding: false }, [{ id: "claude", model: "claude-opus", active: true }]));
add("coding · 编辑器在前台，同时两个 agent 在跑", "intensity 4 · continuity 3 · mixed",
  minutes({ application: "Ghostty", coding: true }, [{ id: "claude", model: "claude-opus", active: true }, { id: "codex", model: "gpt", active: true }]));
add("coding · 整窗在看视频", "intensity 0 · continuity 0 · idle",
  minutes({ application: "Safari", coding: false }, [{ id: "claude", model: "claude-opus", active: false }]));
add("coding · Mac offline, Cursor checked and inactive", "intensity near 0 · continuity near 0 · idle (production uses limited-source rules)",
  [], [{ t: T, available: true, lastActivityAt: T - 3_600_000 }],
  (a) => Number(a.intensity.score) < 0.5 && Number(a.continuity.score) < 0.5 && a.mode.choice === "idle");
add("coding · Mac offline, Cursor active", "intensity > 0 · continuity > 0 · agent",
  [], [{ t: T, available: true, lastActivityAt: T }],
  (a) => Number(a.intensity.score) >= 2.5 && Number(a.continuity.score) >= 2.5 && a.mode.choice === "agent");

for (const c of cases.filter((c) => !process.env.CLEF_PROBE_FILTER || c.name.includes(process.env.CLEF_PROBE_FILTER))) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${model}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, state: c.state, questions: c.questions }),
  });
  if (!res.ok) { console.log(`✗ ${c.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
  const body = (await res.json() as { result: { answers: Answers } }).result;
  const a: Answers = { intensity: body.answers.w0Intensity, continuity: body.answers.w0Continuity, mode: body.answers.w0Mode };
  if (c.check && !c.check(a)) throw new Error(`Expectation failed: ${c.name}`);
  const fmt = (x: Answer) => `${x.score != null ? x.score.toFixed(2) : x.choice} (c=${x.confidence.toFixed(2)})`;
  console.log(`${c.name}\n   期望 ${c.expect}\n   答案 intensity ${fmt(a.intensity)} · continuity ${fmt(a.continuity)} · mode ${fmt(a.mode)} ${JSON.stringify(a.mode.probabilities)}`);
}
