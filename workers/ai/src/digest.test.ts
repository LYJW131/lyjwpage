import assert from "node:assert/strict";
import test from "node:test";

import { digestInputHash } from "./digest/compose";
import { codingAgentSeconds, codingDriverSeconds } from "@shared/pulse-types";

import { agentSeconds, digestFacts, digestHighlightOptions, digestMessage, driverSeconds, type DigestViews } from "./digest/facts";
import { baseViews, FROM, HOUR, NOW } from "./digest/testing/views-fixture";

test("driver and agent time follow the site's definition", () => {
  for (const summary of [{ humanSeconds: 0, agentSeconds: 0, bothSeconds: 0 }, { humanSeconds: 120, agentSeconds: 5_000, bothSeconds: 900 }, { humanSeconds: 7_200, agentSeconds: 0, bothSeconds: 0 }]) {
    assert.equal(driverSeconds(summary), codingDriverSeconds(summary));
    assert.equal(agentSeconds(summary), codingAgentSeconds(summary));
  }
});

test("facts keep the day's highlights, in the owner's time zone, and leave empty lanes out", () => {
  const facts = digestFacts(baseViews(), NOW);
  assert.match(facts, /^Now: Tuesday afternoon in LYJW's time zone \(Asia\/Singapore\)/);
  assert.match(facts, /Coding: LYJW driving \(a coding app in front on the Mac\) 6 h; AI agents working 7 h, of which 3 h on their own while LYJW was not driving/);
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

test("highlight options carry the card's numbers and labels, rounded like the facts, for non-empty topics only", () => {
  assert.deepEqual(digestHighlightOptions(baseViews()), [
    { topic: "coding", value: 6, unit: "hours", atLeast: false, caption: "driver time" },
    { topic: "agents", value: 7, unit: "hours", atLeast: false, caption: "agent time" },
    { topic: "tokens", value: 42_000_000, unit: "count", atLeast: false, caption: "tokens" },
    { topic: "music", value: 3.5, unit: "hours", atLeast: false, caption: "music" },
    { topic: "watching", value: 50, unit: "minutes", atLeast: false, caption: "watching" },
    { topic: "fitness", value: 3_300, unit: "count", atLeast: false, caption: "steps" },
  ]);
  assert.match(digestMessage(baseViews(), NOW).content, /\n\nHighlight options: coding: 6 h driver time; agents: 7 h agent time; tokens: 42M tokens; music: 3\.5 h music; watching: 50 min watching; fitness: 3\.3K steps$/);
});
