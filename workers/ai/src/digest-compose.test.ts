import assert from "node:assert/strict";
import test from "node:test";

import { STATUS_VIEWS } from "@shared/status-views";

import { composeDigest, digestInputHash, HEADLINE_POOL, taglineCandidates, TAGLINE_INSTRUCTIONS } from "./digest/compose";
import { digestMessage } from "./digest/facts";
import { DIGEST_SITUATIONS } from "./digest/situation";
import { DIGEST_TAGLINES } from "./digest/taglines";
import { baseViews, LOCAL_DATE, NOW, reader, recorder, stateLane } from "./digest/testing/views-fixture";

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
  assert.deepEqual(first.digest.highlights.map((item) => item.topic), ["coding", "agents", "tokens"]);
  assert.deepEqual(first.digest.highlights[0], { topic: "coding", value: 9, unit: "hours", atLeast: false, caption: "coding" });
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
