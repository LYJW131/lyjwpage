import assert from "node:assert/strict";
import test from "node:test";

import type { DigestHighlight, DigestTopic } from "@shared/digest";

import { HEADLINE_POOL, headlinePool, isTagline, keepsHeadline, PRIMARY_CANDIDATES, taglineCandidates, taglineCriteria } from "./digest/compose";
import { digestHighlightOptions, type DigestViews } from "./digest/facts";
import { DIGEST_SITUATIONS, digestScene, type DigestSituation } from "./digest/situation";
import { DIGEST_TAGLINES } from "./digest/taglines";
import { baseViews, HOUR, LOCAL_DATE, NOW } from "./digest/testing/views-fixture";

const hoursOption = (topic: DigestTopic, value: number, caption: string = topic): DigestHighlight => ({ topic, value, unit: "hours", atLeast: false, caption });
const minutesOption = (topic: DigestTopic, value: number): DigestHighlight => ({ topic, value, unit: "minutes", atLeast: false, caption: topic });
const countOption = (topic: DigestTopic, value: number, caption: string): DigestHighlight => ({ topic, value, unit: "count", atLeast: false, caption });
const NO_SIGNALS = { weekend: false, workoutMinutes: 0, deploys: 0, date: LOCAL_DATE };

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
    [[hoursOption("coding", 6), hoursOption("agents", 17.5, "agent time"), tokens(3e9), commits(10), hoursOption("music", 12.5), countOption("fitness", 2_300, "steps")], NO_SIGNALS,
      "agentsAllDay [soundtrack,shipping,tokenFlood] coding,agents,music"],
    [[hoursOption("coding", 13), hoursOption("agents", 2, "agent time"), tokens(5e6)], NO_SIGNALS, "codingAllDay [] coding,tokens,agents"],
    [[hoursOption("coding", 2.5), hoursOption("agents", 1, "agent time"), commits(12)], { ...NO_SIGNALS, weekend: true }, "shipping [weekend] site,coding,agents"],
    [[hoursOption("coding", 2.5), hoursOption("agents", 1, "agent time"), commits(3)], { ...NO_SIGNALS, deploys: 4 }, "shipping [] site,coding,agents"],
    [[hoursOption("coding", 5), hoursOption("agents", 1, "agent time"), commits(10)], { ...NO_SIGNALS, deploys: 5 }, "handsOn [shipping] coding,site,agents"],
    [[hoursOption("coding", 2), hoursOption("agents", 5, "agent time"), tokens(8e7)], NO_SIGNALS, "agentsLead [] coding,agents,tokens"],
    [[hoursOption("coding", 1.5), hoursOption("agents", 4, "agent time"), tokens(2.4e8), hoursOption("music", 5)], { ...NO_SIGNALS, weekend: true }, "agentsLead [soundtrack,weekend] coding,agents,music"],
    [[hoursOption("coding", 1.5), hoursOption("agents", 4, "agent time"), tokens(2.4e8), hoursOption("music", 3)], NO_SIGNALS, "agentsLead [] coding,agents,tokens"],
    [[minutesOption("coding", 30), hoursOption("agents", 4, "agent time"), hoursOption("music", 10)], NO_SIGNALS, "musicLong [] music,agents"],
    [[hoursOption("coding", 6), hoursOption("agents", 5, "agent time"), tokens(8e7)], NO_SIGNALS, "handsOn [] coding,tokens,agents"],
    [[hoursOption("agents", 10, "agent time"), tokens(8e7)], NO_SIGNALS, "agentsLead [] agents,tokens"],
    [[hoursOption("coding", 5), hoursOption("agents", 1, "agent time")], { ...NO_SIGNALS, workoutMinutes: 45 }, "handsOn [workoutToo] coding,agents"],
    [[hoursOption("coding", 2), tokens(1e6), hoursOption("music", 1)], NO_SIGNALS, "codingLight [] coding,tokens"],
    [[hoursOption("coding", 2), hoursOption("music", 8)], NO_SIGNALS, "musicLong [] music,coding"],
    [[hoursOption("watching", 4), hoursOption("music", 1), hoursOption("coding", 1)], NO_SIGNALS, "watchingBinge [] watching,music"],
    [[hoursOption("gaming", 2), countOption("trophies", 4, "trophies"), hoursOption("coding", 1)], NO_SIGNALS, "trophyHunt [] trophies,gaming"],
    [[hoursOption("coding", 6), hoursOption("agents", 1, "agent time"), hoursOption("gaming", 3)], NO_SIGNALS, "workAndPlay [] coding,gaming,agents"],
    [[countOption("fitness", 9_000, "steps"), hoursOption("music", 1)], { ...NO_SIGNALS, workoutMinutes: 60 }, "workout [] fitness,music"],
    [[hoursOption("coding", 1.5), hoursOption("agents", 4, "agent time"), countOption("fitness", 14_000, "steps")], { ...NO_SIGNALS, workoutMinutes: 90 }, "agentsLead [workoutToo] coding,agents,fitness"],
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
