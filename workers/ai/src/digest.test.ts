import assert from "node:assert/strict";
import test from "node:test";

import { STATUS_VIEWS } from "@shared/status-views";

import type { DigestHighlight, DigestTopic } from "@shared/digest";

import { composeDigest, digestInputHash, HEADLINE_POOL, headlinePool, isTagline, keepsHeadline, PRIMARY_CANDIDATES, taglineCandidates, taglineCriteria, TAGLINE_INSTRUCTIONS, type PickTagline } from "./digest/compose";
import { digestFacts, digestHighlightOptions, digestMessage, type DigestViews } from "./digest/facts";
import { DIGEST_SITUATIONS, digestScene, type DigestSituation } from "./digest/situation";
import { DIGEST_TAGLINES } from "./digest/taglines";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-13T06:20:00Z");
const FROM = NOW - DAY;

const span = (startHour: number, minutes: number) => ({ startSec: startHour * 3_600, endSec: startHour * 3_600 + minutes * 60 });

function stateLane(plays: { at: number; minutes: number; title: string; subtitle: string | null }[], elsewhere: typeof plays = []) {
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

function baseViews(): DigestViews {
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

function reader(views: DigestViews) {
  const byPath = new Map<string, unknown>(Object.entries(views).map(([key, data]) => [STATUS_VIEWS[key as keyof typeof STATUS_VIEWS].path, data]));
  return async (path: string) => Response.json({ ok: true, data: byPath.get(path) ?? null });
}

test("facts keep the day's highlights, in the owner's time zone, and leave empty lanes out", () => {
  const facts = digestFacts(baseViews(), NOW);
  assert.match(facts, /^Now: Tuesday afternoon in LYJW's time zone \(Asia\/Singapore\)/);
  assert.match(facts, /Coding: LYJW hands-on \(a coding app in front on the Mac\) 6 h; AI agents working 7 h/);
  assert.match(facts, /Coding agents used: Claude Code \(Opus 5\.5\)\n/, "agents idle for the whole window are left out");
  assert.match(facts, /Tokens through the agents: 42M/);
  assert.match(facts, /Music: 3\.5 h, 14 tracks; top artists Hoshimachi Suisei \(3 h\), Houshou Marine & Hoshimachi Suisei \(25 min\); most played tracks GUM&DROP \(30 min\)/);
  assert.match(facts, /Watching on Emby: 50 min; 辉夜大小姐想让我告白 \[S3:E4, S3:E5\] \(50 min\)/);
  assert.doesNotMatch(facts, /Gaming|trophies|homepage's own code/);
  assert.match(facts, /Steps: 3,300 in 24 h\nNo workout \(last one: Walking, 8 days ago\)$/);
});

test("facts leave steps out when no step buckets arrived, instead of claiming zero", () => {
  const views = baseViews();
  views.pulse!.lanes.activity.summary.steps = 0;
  const facts = digestFacts(views, NOW);
  assert.doesNotMatch(facts, /Steps/);
  assert.match(facts, /\nNo workout \(last one: Walking, 8 days ago\)$/);
});

test("counts from capped source lists read as lower bounds while the oldest listed entry is inside the window", () => {
  const views = baseViews();
  const at = (hoursAgo: number) => NOW - hoursAgo * HOUR;
  const commits = Array.from({ length: 10 }, (_, index) => ({ title: `feat(site): change ${index}`, committedAt: new Date(at(1 + index)).toISOString() }));
  const deploys = [
    { target: "production", state: "READY", createdAt: at(1) },
    { target: "preview", state: "READY", createdAt: at(2) },
    { target: "production", state: "ERROR", createdAt: at(3) },
    { target: "production", state: "READY", createdAt: at(4) },
    { target: "production", state: "READY", createdAt: at(5) },
  ];
  const trophies = [
    { trophyName: "Gold Rush", type: "gold", titleName: "ASTRO BOT", earnedAt: at(1) },
    { trophyName: "Silver Lining", type: "silver", titleName: "ASTRO BOT", earnedAt: at(2) },
    { trophyName: "Bronze Age", type: "bronze", titleName: "ASTRO BOT", earnedAt: at(3) },
  ];
  views.githubRepo = { recentCommits: commits } as unknown as DigestViews["githubRepo"];
  views.siteDeployments = { recent: deploys } as unknown as DigestViews["siteDeployments"];
  views.trophies = { recent: trophies } as unknown as DigestViews["trophies"];

  let facts = digestFacts(views, NOW);
  assert.match(facts, /This homepage's own code: 10\+ commits, 3\+ production deploys; areas touched site\n/);
  assert.match(facts, /PlayStation trophies earned: 3\+; Gold Rush \(gold, ASTRO BOT\), Silver Lining \(silver, ASTRO BOT\), Bronze Age \(bronze, ASTRO BOT\)\n/);

  commits[9].committedAt = new Date(at(30)).toISOString();
  deploys[4].createdAt = at(30);
  trophies[2].earnedAt = at(30);
  facts = digestFacts(views, NOW);
  assert.match(facts, /This homepage's own code: 9 commits, 2 production deploys;/);
  assert.match(facts, /PlayStation trophies earned: 2; Gold Rush \(gold, ASTRO BOT\), Silver Lining \(silver, ASTRO BOT\)\n/);

  views.siteDeployments = { recent: deploys.map((deploy) => ({ ...deploy, target: "preview", createdAt: at(2) })) } as unknown as DigestViews["siteDeployments"];
  assert.match(digestFacts(views, NOW), /This homepage's own code: 9 commits; areas touched site\n/);

  views.githubRepo = {} as unknown as DigestViews["githubRepo"];
  views.siteDeployments = { recent: deploys } as unknown as DigestViews["siteDeployments"];
  facts = digestFacts(views, NOW);
  assert.match(facts, /This homepage's own code: 2 production deploys\n/);
  assert.doesNotMatch(facts, /commits/);
});

test("facts round small changes away, so an unchanged hour keeps the same input hash", async () => {
  const before = baseViews();
  const after = baseViews();
  const coding = after.pulse!.lanes.coding.summary;
  coding.humanSeconds += 240;
  after.pulse!.lanes.activity.summary.steps += 30;
  after.pulse!.lanes.tokens.summary.totalTokens += 200_000;
  after.pulse!.window = { from: FROM + 20 * 60_000, to: NOW + 20 * 60_000 };
  assert.equal(digestFacts(after, NOW + 20 * 60_000), digestFacts(before, NOW));
  assert.equal(await digestInputHash(digestFacts(after, NOW + 20 * 60_000)), await digestInputHash(digestFacts(before, NOW)));
});

test("an unknown time zone falls back to the site's", () => {
  const views = baseViews();
  views.timezone = { timezone: { identifier: "Mars/Olympus", abbreviation: null, secondsFromGMT: 0, observedAt: NOW }, snapshotAt: NOW };
  assert.match(digestFacts(views, NOW), /^Now: Tuesday afternoon in LYJW's time zone \(Asia\/Shanghai\)/);
});

function recorder(choice: unknown = "t2") {
  const calls: { state: unknown; questions: Record<string, unknown> }[] = [];
  const pick: PickTagline = async (input) => {
    calls.push(input);
    if (choice instanceof Error) throw choice;
    return { answers: { tagline: { type: "choice", choice } } };
  };
  return { calls, pick };
}

const LOCAL_DATE = "2026-10-13";

test("highlight options carry the card's numbers and labels, rounded like the facts, for non-empty topics only", () => {
  assert.deepEqual(digestHighlightOptions(baseViews()), [
    { topic: "coding", value: 6, unit: "hours", atLeast: false, caption: "hands-on" },
    { topic: "agents", value: 7, unit: "hours", atLeast: false, caption: "agent time" },
    { topic: "tokens", value: 42_000_000, unit: "count", atLeast: false, caption: "tokens" },
    { topic: "music", value: 3.5, unit: "hours", atLeast: false, caption: "music" },
    { topic: "watching", value: 50, unit: "minutes", atLeast: false, caption: "watching" },
    { topic: "fitness", value: 3_300, unit: "count", atLeast: false, caption: "steps" },
  ]);
  assert.match(digestMessage(baseViews(), NOW).content, /\n\nHighlight options: coding: 6 h hands-on; agents: 7 h agent time; tokens: 42M tokens; music: 3\.5 h music; watching: 50 min watching; fitness: 3\.3K steps$/);
});

test("compose reads the situation by rule, lets Clef pick one stored tagline, and skips the round while the facts stand still", async () => {
  const { calls, pick } = recorder("t2");
  const readStatus = reader(baseViews());
  const candidates = taglineCandidates("agentsLead", [], LOCAL_DATE);

  const first = await composeDigest({ readStatus, pick, previousInputHash: null, previousHeadline: null, now: NOW });
  assert.equal(first.status, "composed");
  if (first.status !== "composed") return;
  assert.equal(first.digest.headline, candidates[2]);
  assert.equal(first.digest.headlines?.[0], candidates[2]);
  assert.equal(first.digest.headlines?.length, HEADLINE_POOL);
  assert.ok(first.digest.headlines?.every((line) => DIGEST_TAGLINES.agentsLead.includes(line)));
  assert.equal(first.digest.model, "@cf/cloudflare/clef");
  assert.deepEqual(first.digest.highlights.map((item) => item.topic), ["agents", "coding", "tokens"]);
  assert.deepEqual(first.digest.highlights[1], { topic: "coding", value: 6, unit: "hours", atLeast: false, caption: "hands-on" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].questions, {
    tagline: { type: "choice", instructions: TAGLINE_INSTRUCTIONS, criteria: Object.fromEntries(candidates.map((line, index) => [`t${index}`, `${line}｜主线：${DIGEST_SITUATIONS.agentsLead}`])) },
  });
  assert.deepEqual(calls[0].state, { facts: digestMessage(baseViews(), NOW).content.split("\n").filter(Boolean), situation: DIGEST_SITUATIONS.agentsLead, accents: [] });

  assert.deepEqual(await composeDigest({ readStatus, pick, previousInputHash: first.digest.inputHash, previousHeadline: first.digest.headline, now: NOW }), { status: "unchanged" });
  assert.equal(calls.length, 1);
});

test("a digest hashed before the situation rules changed is recomposed even though its facts stand still", async () => {
  const facts = digestMessage(baseViews(), NOW).content;
  const outcome = await composeDigest({ readStatus: reader(baseViews()), pick: recorder("t0").pick, previousInputHash: await digestInputHash(facts), previousHeadline: null, now: NOW });
  assert.equal(outcome.status, "composed");
});

test("the last headline stays while it is still a candidate, and a new one is picked once it is not", async () => {
  const { calls, pick } = recorder("t0");
  const readStatus = reader(baseViews());
  const kept = taglineCandidates("agentsLead", [], LOCAL_DATE)[4];
  const stay = await composeDigest({ readStatus, pick, previousInputHash: "older", previousHeadline: kept, now: NOW });
  assert.equal(stay.status === "composed" && stay.digest.headline, kept);
  assert.equal(stay.status === "composed" && stay.digest.model, "rules");
  assert.equal(calls.length, 0);

  const gone = await composeDigest({ readStatus, pick, previousInputHash: "older", previousHeadline: DIGEST_TAGLINES.trophyHunt[0], now: NOW });
  assert.equal(gone.status === "composed" && gone.digest.headline, taglineCandidates("agentsLead", [], LOCAL_DATE)[0]);
  assert.equal(calls.length, 1);
});

test("without Clef, or when Clef fails or answers off the list, the rules take the first candidate", async (t) => {
  t.mock.method(console, "warn", () => {});
  const readStatus = reader(baseViews());
  const first = taglineCandidates("agentsLead", [], LOCAL_DATE)[0];
  for (const pick of [undefined, recorder(new Error("AI down")).pick, recorder("t99").pick, recorder("coding").pick]) {
    const outcome = await composeDigest({ readStatus, pick, previousInputHash: null, previousHeadline: null, now: NOW });
    assert.equal(outcome.status === "composed" && outcome.digest.headline, first);
    assert.equal(outcome.status === "composed" && outcome.digest.model, "rules");
  }
});

test("compose fails the round instead of publishing a digest missing a view", async () => {
  const readStatus = reader(baseViews());
  const withoutPulse = { ...baseViews(), pulse: null };
  const { calls, pick } = recorder();
  await assert.rejects(composeDigest({ readStatus: reader(withoutPulse), pick, previousInputHash: null, previousHeadline: null, now: NOW }), /Pulse view unavailable/);
  const workoutsPath = STATUS_VIEWS.workouts.path;
  const failures: [(path: string) => Promise<Response>, RegExp][] = [
    [async (path) => (path === workoutsPath ? Response.json({ ok: false, error: "状态暂不可用" }) : readStatus(path)), /Digest view workouts unavailable: 状态暂不可用/],
    [async (path) => (path === workoutsPath ? new Response("Bad gateway", { status: 502 }) : readStatus(path)), /Digest view workouts unavailable: HTTP 502/],
    [async (path) => { if (path === workoutsPath) throw new Error("RPC dropped"); return readStatus(path); }, /RPC dropped/],
  ];
  for (const [failing, error] of failures) {
    await assert.rejects(composeDigest({ readStatus: failing, pick, previousInputHash: null, previousHeadline: null, now: NOW }), error);
  }
  assert.equal(calls.length, 0);
});

const hoursOption = (topic: DigestTopic, value: number, caption: string = topic): DigestHighlight => ({ topic, value, unit: "hours", atLeast: false, caption });
const minutesOption = (topic: DigestTopic, value: number): DigestHighlight => ({ topic, value, unit: "minutes", atLeast: false, caption: topic });
const countOption = (topic: DigestTopic, value: number, caption: string): DigestHighlight => ({ topic, value, unit: "count", atLeast: false, caption });
const NO_SIGNALS = { weekend: false, workoutMinutes: 0, deploys: 0, date: LOCAL_DATE };

test("a quiet day publishes an empty digest that the card shows as the clock, and keeps the input hash", async () => {
  const views = baseViews();
  const lanes = views.pulse!.lanes;
  lanes.coding.summary = { humanSeconds: 0, agentSeconds: 0, bothSeconds: 0 };
  lanes.tokens.summary.totalTokens = 0;
  lanes.listening = stateLane([{ at: 9, minutes: 15, title: "GUM&DROP", subtitle: "Hoshimachi Suisei" }]) as typeof lanes.listening;
  lanes.watching = stateLane([]) as typeof lanes.watching;
  const { calls, pick } = recorder();
  const outcome = await composeDigest({ readStatus: reader(views), pick, previousInputHash: null, previousHeadline: "代码不停歇", now: NOW });
  assert.equal(outcome.status, "composed");
  if (outcome.status !== "composed") return;
  assert.equal(outcome.digest.quiet, true);
  assert.equal(outcome.digest.headline, "");
  assert.deepEqual(outcome.digest.highlights, []);
  assert.match(outcome.digest.inputHash, /^[0-9a-f]{64}$/);
  assert.equal(calls.length, 0);
});

test("the quiet line matches what the model used to call quiet", () => {
  const steps = countOption("fitness", 3_300, "steps");
  assert.deepEqual(digestScene([minutesOption("music", 15), steps], NO_SIGNALS), { quiet: true });
  assert.deepEqual(digestScene([steps], NO_SIGNALS), { quiet: true });
  assert.equal(digestScene([hoursOption("coding", 1.5), steps], NO_SIGNALS).quiet, false);
  assert.equal(digestScene([hoursOption("music", 2.5), steps], NO_SIGNALS).quiet, false);
  assert.equal(digestScene([steps], { ...NO_SIGNALS, workoutMinutes: 40 }).quiet, false);
  assert.equal(digestScene([countOption("trophies", 1, "trophies")], NO_SIGNALS).quiet, false);
  assert.equal(digestScene([countOption("site", 1, "commits")], NO_SIGNALS).quiet, true);
  assert.deepEqual(digestScene([countOption("site", 1, "commits")], { ...NO_SIGNALS, deploys: 4 }), { quiet: false, primary: "shipping", accents: [], highlights: [countOption("site", 1, "commits")] });
});

test("situations, accents and picks follow the day's lead", () => {
  const scene = (options: DigestHighlight[], signals = NO_SIGNALS) => {
    const result = digestScene(options, signals);
    return result.quiet ? "quiet" : `${result.primary} [${result.accents.join(",")}] ${result.highlights.map((item) => item.topic).join(",")}`;
  };
  const tokens = (value: number) => countOption("tokens", value, "tokens");
  const commits = (value: number) => countOption("site", value, "commits");
  const cases: [DigestHighlight[], typeof NO_SIGNALS, string][] = [
    [[hoursOption("coding", 23), hoursOption("agents", 17.5, "agent time"), tokens(3e9), commits(10), hoursOption("music", 12.5), countOption("fitness", 2_300, "steps")], NO_SIGNALS,
      "agentsAllDay [soundtrack,shipping,tokenFlood] agents,coding,tokens"],
    [[minutesOption("coding", 10), hoursOption("agents", 19, "agent time"), tokens(1.2e9)], NO_SIGNALS, "agentsAllDay [tokenFlood] agents,coding,tokens"],
    [[minutesOption("coding", 10), hoursOption("agents", 10, "agent time"), hoursOption("watching", 3)], NO_SIGNALS, "workAndPlay [] agents,watching,coding"],
    [[hoursOption("coding", 13), hoursOption("agents", 2, "agent time"), tokens(5e6)], NO_SIGNALS, "codingAllDay [] coding,tokens,agents"],
    [[hoursOption("coding", 2.5), hoursOption("agents", 1, "agent time"), commits(12)], { ...NO_SIGNALS, weekend: true }, "shipping [weekend] site,coding,agents"],
    [[hoursOption("coding", 2.5), hoursOption("agents", 1, "agent time"), commits(3)], { ...NO_SIGNALS, deploys: 4 }, "shipping [] site,coding,agents"],
    [[hoursOption("coding", 5), hoursOption("agents", 1, "agent time"), commits(10)], { ...NO_SIGNALS, deploys: 5 }, "handsOn [shipping] coding,site,agents"],
    [[hoursOption("coding", 6), hoursOption("agents", 5, "agent time"), tokens(8e7)], NO_SIGNALS, "agentsLead [] agents,coding,tokens"],
    [[hoursOption("coding", 5), hoursOption("agents", 1, "agent time")], { ...NO_SIGNALS, workoutMinutes: 45 }, "handsOn [workoutToo] coding,agents"],
    [[hoursOption("coding", 2), tokens(1e6), hoursOption("music", 1)], NO_SIGNALS, "codingLight [] coding,tokens"],
    [[hoursOption("coding", 2), hoursOption("music", 8)], NO_SIGNALS, "musicLong [] music,coding"],
    [[hoursOption("watching", 4), hoursOption("music", 1), hoursOption("coding", 1)], NO_SIGNALS, "watchingBinge [] watching,music"],
    [[hoursOption("gaming", 2), countOption("trophies", 4, "trophies"), hoursOption("coding", 1)], NO_SIGNALS, "trophyHunt [] trophies,gaming"],
    [[hoursOption("coding", 6), hoursOption("agents", 1, "agent time"), hoursOption("gaming", 3)], NO_SIGNALS, "workAndPlay [] coding,gaming,agents"],
    [[countOption("fitness", 9_000, "steps"), hoursOption("music", 1)], { ...NO_SIGNALS, workoutMinutes: 60 }, "workout [] fitness,music"],
    [[hoursOption("coding", 4), hoursOption("agents", 2.5, "agent time"), countOption("fitness", 14_000, "steps")], { ...NO_SIGNALS, workoutMinutes: 90 }, "agentsLead [workoutToo] agents,coding"],
    [[hoursOption("coding", 2), hoursOption("music", 10), countOption("fitness", 24_000, "steps")], { ...NO_SIGNALS, workoutMinutes: 90 }, "musicLong [workoutToo] music,fitness"],
    [[countOption("fitness", 16_000, "steps"), minutesOption("coding", 30)], NO_SIGNALS, "walking [] fitness,coding"],
  ];
  for (const [options, signals, expected] of cases) assert.equal(scene(options, signals), expected);
});

test("the tagline library covers every situation with enough well-formed, distinct lines", () => {
  const all = Object.values(DIGEST_TAGLINES).flat();
  assert.deepEqual(Object.keys(DIGEST_TAGLINES).sort(), Object.keys(DIGEST_SITUATIONS).sort());
  for (const [situation, lines] of Object.entries(DIGEST_TAGLINES)) assert.ok(lines.length >= PRIMARY_CANDIDATES * 2, situation);
  assert.deepEqual(all.filter((line) => !isTagline(line)), []);
  assert.equal(new Set(all).size, all.length);
});

test("the headline pool leads with the picked line and fills from the lead theme without repeats", () => {
  const weekendLine = DIGEST_TAGLINES.weekend[0];
  const pool = headlinePool(weekendLine, "gaming", LOCAL_DATE);
  assert.equal(pool[0], weekendLine);
  assert.equal(pool.length, HEADLINE_POOL);
  assert.ok(pool.slice(1).every((line) => DIGEST_TAGLINES.gaming.includes(line)));
  const own = headlinePool(taglineCandidates("gaming", [], LOCAL_DATE)[3], "gaming", LOCAL_DATE);
  assert.equal(new Set(own).size, HEADLINE_POOL);
  assert.deepEqual(headlinePool(own[0], "gaming", LOCAL_DATE), own);
});

test("candidates stay put through the day and rotate at midnight", () => {
  const today = taglineCandidates("agentsAllDay", ["soundtrack", "weekend"], LOCAL_DATE);
  assert.equal(today.length, PRIMARY_CANDIDATES + 4);
  assert.deepEqual(taglineCandidates("agentsAllDay", ["soundtrack", "weekend"], LOCAL_DATE), today);
  assert.notDeepEqual(taglineCandidates("agentsAllDay", ["soundtrack", "weekend"], "2026-10-14"), today);
  for (const line of today.slice(0, PRIMARY_CANDIDATES)) assert.ok(DIGEST_TAGLINES.agentsAllDay.includes(line));
  assert.ok((["soundtrack", "weekend"] as DigestSituation[]).every((accent) => today.some((line) => DIGEST_TAGLINES[accent].includes(line))));
});

test("only a line of the day's lead carries over, so a weekend line picked while coding does not stay once watching takes over", () => {
  const candidates = taglineCandidates("codingAllDay", ["weekend"], LOCAL_DATE);
  const weekendLine = candidates.find((line) => DIGEST_TAGLINES.weekend.includes(line))!;
  assert.equal(keepsHeadline(candidates[0], "codingAllDay", LOCAL_DATE), true);
  assert.equal(keepsHeadline(weekendLine, "codingAllDay", LOCAL_DATE), false);
  assert.equal(keepsHeadline(weekendLine, "watching", LOCAL_DATE), false);
  assert.equal(keepsHeadline(null, "codingAllDay", LOCAL_DATE), false);
});

test("each option tells Clef which theme the line was written for and whether that theme leads the day", () => {
  const candidates = taglineCandidates("codingAllDay", ["weekend"], LOCAL_DATE);
  const criteria = Object.values(taglineCriteria(candidates, "codingAllDay"));
  assert.equal(criteria[0], `${candidates[0]}｜主线：${DIGEST_SITUATIONS.codingAllDay}`);
  assert.equal(criteria.at(-1), `${candidates.at(-1)}｜附带：${DIGEST_SITUATIONS.weekend}`);
});

test("a trophy count from a capped list becomes an at-least option", () => {
  const views = baseViews();
  views.trophies = { recent: [{ trophyName: "Gold Rush", type: "gold", titleName: "ASTRO BOT", earnedAt: NOW - HOUR }] } as unknown as DigestViews["trophies"];
  assert.deepEqual(digestHighlightOptions(views).find((item) => item.topic === "trophies"), { topic: "trophies", value: 1, unit: "count", atLeast: true, caption: "trophies" });
});
