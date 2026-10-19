import { STATUS_VIEWS } from "@shared/status-views";
import type { PickTagline } from "../compose";
import type { DigestViews } from "../facts";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const NOW = Date.parse("2026-10-13T06:20:00Z");
export const FROM = NOW - DAY;

export const span = (startHour: number, minutes: number) => ({ startSec: startHour * 3_600, endSec: startHour * 3_600 + minutes * 60 });

export function stateLane(plays: { at: number; minutes: number; title: string; subtitle: string | null }[], elsewhere: typeof plays = []) {
  const rows = plays.map((play) => ({ ...span(play.at, play.minutes), state: 2, title: play.title, subtitle: play.subtitle }));
  const columns = (list: typeof rows) => ({
    startSec: list.map((row) => row.startSec),
    endSec: list.map((row) => row.endSec),
    state: list.map((row) => row.state),
    title: list.map((row) => row.title),
    subtitle: list.map((row) => row.subtitle),
  });
  const traces = elsewhere.map((play) => ({ ...span(play.at, play.minutes), title: play.title, subtitle: play.subtitle }));
  const all = [...plays, ...elsewhere];
  return {
    kind: "state",
    segments: columns(rows),
    ...(elsewhere.length ? {
      uncertain: {
        startSec: traces.map((row) => row.startSec),
        endSec: traces.map((row) => row.endSec),
        title: traces.map((row) => row.title),
        subtitle: traces.map((row) => row.subtitle),
        marginSec: traces.map(() => 30),
      },
    } : {}),
    summary: { activeSeconds: all.reduce((sum, play) => sum + play.minutes * 60, 0), titles: new Set(all.map((play) => play.title)).size },
  };
}

export function baseViews(): DigestViews {
  const songs = Array.from({ length: 40 }, (_, index) => ({ at: 1 + index * 0.1, minutes: 4, title: `Song ${index % 12}`, subtitle: "Hoshimachi Suisei" }));
  return {
    pulse: {
      generatedAt: NOW,
      window: { from: FROM, to: NOW },
      lanes: {
        coding: {
          kind: "coding",
          segments: { startSec: [], endSec: [], value: [], agentSources: [] },
          assessments: { startSec: [], endSec: [], intensity: [], confidence: [], mode: [] },
          summary: { humanSeconds: 2 * 3_600, agentSeconds: 3 * 3_600, bothSeconds: 4 * 3_600 },
        },
        tokens: {
          kind: "tokens",
          buckets: { startSec: [], endSec: [], total: [], output: [], cacheRead: [] },
          summary: { peakPerMinute: null, currentPerMinute: null, totalTokens: 41_522_932 },
        },
        listening: stateLane(
          [...songs, { at: 9, minutes: 30, title: "GUM&DROP", subtitle: "Hoshimachi Suisei" }],
          [{ at: 12, minutes: 25, title: "Chatter Chatter", subtitle: "Houshou Marine & Hoshimachi Suisei" }],
        ),
        watching: stateLane([
          { at: 20, minutes: 24, title: "辉夜大小姐想让我告白", subtitle: "S3:E4 · 『燕的子安贝」篇①』" },
          { at: 20.5, minutes: 24, title: "辉夜大小姐想让我告白", subtitle: "S3:E5 · 石上优想要回应" },
        ]),
        gaming: stateLane([]),
        charging: { kind: "power", segments: { startSec: [], endSec: [], watts: [] }, currentPowerW: null, summary: { peakW: null, energyWh: 0 } },
        activity: { kind: "steps", buckets: { startSec: [], endSec: [], steps: [] }, workouts: { startSec: [], endSec: [], activityType: [] }, summary: { steps: 3_255 } },
      },
    } as unknown as DigestViews["pulse"],
    timezone: { timezone: { identifier: "Asia/Singapore", abbreviation: "SGT", secondsFromGMT: 28_800, observedAt: NOW }, snapshotAt: NOW },
    activity: null,
    workouts: {
      pushedAt: NOW,
      items: [{ id: "w1", activityType: "Walking", startedAt: NOW - 8 * DAY - 2 * HOUR, endedAt: NOW - 8 * DAY, secondsFromGMT: 28_800, durationSeconds: 5_790, distanceMeters: 8_175, activeEnergyKcal: 457, elevationAscendedMeters: null, indoor: false }],
    },
    coding: null,
    codingNow: {
      agents: [
        { id: "claude", activity: [{ source: "agents-otlp", lastActivityAt: NOW - 60_000, model: "claude-opus-5-5" }] },
        { id: "pi", activity: [{ source: "mac", lastActivityAt: NOW - 30 * DAY, model: "gpt" }] },
      ],
      lastSeenAt: NOW, declaredOffline: false, heartbeatWindowMs: 300_000,
    },
    trophies: null,
    githubRepo: null,
    siteDeployments: null,
  };
}

export function reader(views: DigestViews) {
  const byPath = new Map<string, unknown>(Object.entries(views).map(([key, data]) => [STATUS_VIEWS[key as keyof typeof STATUS_VIEWS].path, data]));
  return async (path: string) => Response.json({ ok: true, data: byPath.get(path) ?? null });
}

export function recorder(choice: unknown = "t2") {
  const calls: { state: unknown; questions: Record<string, unknown> }[] = [];
  const pick: PickTagline = async (input) => {
    calls.push(input);
    if (choice instanceof Error) throw choice;
    return { answers: { tagline: { type: "choice", choice } } };
  };
  return { calls, pick };
}

export const LOCAL_DATE = "2026-10-13";
