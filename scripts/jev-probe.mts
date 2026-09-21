/**
 * 拿代表性窗口打真实 Jev，看判据是不是按我们的意思在答。
 * 用法：node --experimental-strip-types --import ./src/lib/testing/register-alias.mjs scripts/jev-probe.mts
 * key 读 .env.local 的 TYPESAFE_API_KEY。只打印答案，不打印 key。
 */
import { readFileSync } from "node:fs";
import { activityQuestions, activityWindowFeatures } from "@shared/pulse-activity";
import { chargingQuestions, chargingWindowFeatures } from "@shared/pulse-charging";
import { gamingQuestions, gamingWindowFeatures } from "@shared/pulse-gaming";
import { listeningQuestions, listeningWindowFeatures } from "@shared/pulse-listening";
import { watchingQuestions, watchingWindowFeatures } from "@shared/pulse-watching";
import type { PulseSample } from "@/lib/types";

const key = readFileSync(".env.local", "utf8").match(/^TYPESAFE_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("no TYPESAFE_API_KEY in .env.local");
const T = 1_800_000_000_000, M = 60_000, W = { from: T, to: T + 5 * M };
const s = (min: number, level: 0 | 1 | 2 | 3, untilMin: number, extra: Partial<PulseSample> = {}): PulseSample => ({ t: T + min * M, level, until: T + untilMin * M, ...extra });

type Case = { name: string; expect: string; state: unknown; questions: Record<string, unknown> };
const cases: Case[] = [];
const L = (name: string, expect: string, samples: PulseSample[], plays: Parameters<typeof listeningWindowFeatures>[2] = []) =>
  cases.push({ name: `listening · ${name}`, expect, state: listeningWindowFeatures(samples, W, plays).features, questions: listeningQuestions() });
L("专辑放到底，5 分钟 1 次换曲", "intensity 4 · continuity 3 · steady",
  [s(0, 3, 3, { hint: "Hamilton – Helpless" }), s(3, 3, 5, { hint: "Hamilton – Satisfied" })]);
L("一直在放，4 次换曲（挑歌）", "intensity 4 · continuity 3 · selecting",
  [s(0, 3, 1, { hint: "A" }), s(1, 3, 2, { hint: "B" }), s(2, 3, 3, { hint: "C" }), s(3, 3, 4, { hint: "D" }), s(4, 3, 5, { hint: "E" })]);
L("没有实测，只有一条最近在听痕迹", "intensity 1 · continuity 0 · traces", [], [{ t: W.to, since: W.to - 3 * M, hint: "YOASOBI – アイドル" }]);
L("整窗空闲", "intensity 0 · continuity 0 · idle", [s(0, 0, 5)]);
L("放 2 分钟，暂停 3 分钟", "intensity 2 · continuity 2 左右 · paused",
  [s(0, 3, 2, { hint: "A" }), s(2, 2, 5, { hint: "A" })]);
L("两段各半分钟的碎片", "intensity 1 · continuity 1 · steady",
  [s(0, 3, 0.5, { hint: "A" }), s(0.5, 0, 3), s(3, 3, 3.5, { hint: "B" }), s(3.5, 0, 5)]);
L("放了 4 分钟，最后 1 分钟没上报（unknown）", "intensity 4（observed 内全程）· continuity 3",
  [s(0, 3, 4, { hint: "A" })]);

cases.push({ name: "watching · 播 2.5 分钟暂停 2.5", expect: "intensity 2", state: watchingWindowFeatures([s(0, 3, 2.5, { hint: "Ep 1" }), s(2.5, 2, 5, { hint: "Ep 1" })], W).features, questions: watchingQuestions() });
cases.push({ name: "gaming · 主机在线整窗没进游戏", expect: "intensity 0 · continuity 0", state: gamingWindowFeatures([s(0, 1, 5)], W).features, questions: gamingQuestions() });
cases.push({ name: "gaming · 整窗在玩", expect: "intensity 4 · continuity 3", state: gamingWindowFeatures([s(0, 3, 5, { hint: "Pragmata" })], W).features, questions: gamingQuestions() });
cases.push({ name: "charging · 72 W 整窗", expect: "intensity 4 · continuity 3", state: chargingWindowFeatures([s(0, 3, 5, { powerW: 72.5 })], W).features, questions: chargingQuestions() });
cases.push({ name: "charging · 8 W 涓流整窗", expect: "intensity 1 · continuity 3", state: chargingWindowFeatures([s(0, 1, 5, { powerW: 8 })], W).features, questions: chargingQuestions() });
cases.push({ name: "activity · 整窗 vigorous", expect: "intensity 4 · continuity 3", state: activityWindowFeatures([s(0, 3, 5)], W).features, questions: activityQuestions() });
cases.push({ name: "activity · 只有 light", expect: "intensity 1 · continuity 0", state: activityWindowFeatures([s(0, 1, 5)], W).features, questions: activityQuestions() });

for (const c of cases) {
  const res = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-1.13.0", state: c.state, questions: c.questions }),
  });
  if (!res.ok) { console.log(`✗ ${c.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); continue; }
  const body = await res.json() as { answers: Record<string, { type: string; score?: number; choice?: string; confidence: number; probabilities: Record<string, number> }> };
  const a = body.answers;
  const fmt = (x: { score?: number; choice?: string; confidence: number }) => `${x.score != null ? x.score.toFixed(2) : x.choice} (c=${x.confidence.toFixed(2)})`;
  console.log(`${c.name}\n   期望 ${c.expect}\n   答案 intensity ${fmt(a.intensity)} · continuity ${fmt(a.continuity)}${a.mode ? ` · mode ${fmt(a.mode)} ${JSON.stringify(a.mode.probabilities)}` : ""}`);
}
