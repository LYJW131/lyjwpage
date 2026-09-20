import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDiscordReport } from "./discord-parse.ts";
import { discordPayload } from "./discord.ts";
import { acceptPush, guardPolled } from "./status-reads.ts";
import { DISCORD_PATH } from "./paths.ts";

const game = { name: "Beat Saber", platform: "meta_quest", applicationId: "451991967149195264", largeImageUrl: "https://cdn.discordapp.com/app-icons/1/a.png" };
const envelope = (playing: unknown = game) => ({ version: 1, presence: { observedAt: 1000, discordStatus: "online", playing } });

test("Quest reports preserve game details; non-Quest games are rejected", () => {
  assert.equal(normalizeDiscordReport(envelope()).playing?.name, "Beat Saber");
  for (const platform of ["ps4", "ps5", "desktop"]) {
    assert.throws(() => normalizeDiscordReport(envelope({ ...game, platform })), /Only Meta Quest/);
  }
  assert.equal(normalizeDiscordReport(envelope(null)).playing, null);
});
test("offline and stale activity are distinct from live activity", () => {
  const report = envelope();
  report.presence.discordStatus = "offline";
  assert.equal(normalizeDiscordReport(report).playing, null);
  const presence = normalizeDiscordReport(envelope());
  assert.equal(discordPayload(presence, 2000).staleAtSource, false);
  assert.equal(discordPayload(presence, 302000).staleAtSource, true);
});
test("malformed envelopes and untrusted image URLs cannot reach the card", () => {
  assert.throws(() => normalizeDiscordReport({ version: 2 }), /version/);
  assert.throws(() => normalizeDiscordReport({ version: 1, presence: { observedAt: 0 } }));
  for (const largeImageUrl of ["javascript:alert(1)", "https://example.com/test.png", "http://cdn.discordapp.com/test.png"]) {
    assert.equal(normalizeDiscordReport(envelope({ ...game, largeImageUrl })).playing?.largeImageUrl, null);
  }
});
test("late polls and pushes cannot restore an older Quest game", () => {
  const fresh = { ok: true as const, data: discordPayload({ ...normalizeDiscordReport(envelope(null)), observedAt: 5000 }, 5000) };
  const old = { ok: true as const, data: discordPayload(normalizeDiscordReport(envelope()), 5000) };
  assert.equal(acceptPush(DISCORD_PATH, fresh), true);
  assert.equal(acceptPush(DISCORD_PATH, old), false);
  assert.deepEqual(guardPolled(DISCORD_PATH, old), fresh);
});
