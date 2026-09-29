/**
 * 拿代表性窗口打真实 Jev，看 Coding 的判据是不是按我们的意思在答。
 * 用法：node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs scripts/jev-probe.mts
 * key 读 .env.local 的 TYPESAFE_API_KEY。只打印答案，不打印 key。
 *
 * Pulse 只有 Coding 一条道送 Jev，别的道画的是事实时间线。
 */
import { readFileSync } from "node:fs";
import { codingQuestions, codingWindowFeatures, type CodingObservation } from "@shared/pulse-coding";

const key = process.env.TYPESAFE_API_KEY || readFileSync(".env.local", "utf8").match(/^TYPESAFE_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("no TYPESAFE_API_KEY in .env.local");
const T = 1_800_000_000_000, M = 60_000, WINDOW = 5 * M;

type Case = { name: string; expect: string; state: unknown; questions: Record<string, unknown>; check?: (a: Answers) => boolean };
type Answer = { type: string; score?: number; choice?: string; confidence: number; probabilities: Record<string, number> };
type Answers = Record<string, Answer>;
const cases: Case[] = [];

/** 每分钟一条观测，整窗同一个样子 */
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

for (const c of cases.filter((c) => !process.env.JEV_PROBE_FILTER || c.name.includes(process.env.JEV_PROBE_FILTER))) {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-1.13.0", state: c.state, questions: c.questions }),
  });
  if (!res.ok) { console.log(`✗ ${c.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
  const body = await res.json() as { answers: Answers };
  const a: Answers = { intensity: body.answers.w0Intensity, continuity: body.answers.w0Continuity, mode: body.answers.w0Mode };
  if (c.check && !c.check(a)) throw new Error(`Expectation failed: ${c.name}`);
  const fmt = (x: Answer) => `${x.score != null ? x.score.toFixed(2) : x.choice} (c=${x.confidence.toFixed(2)})`;
  console.log(`${c.name}\n   期望 ${c.expect}\n   答案 intensity ${fmt(a.intensity)} · continuity ${fmt(a.continuity)} · mode ${fmt(a.mode)} ${JSON.stringify(a.mode.probabilities)}`);
}
