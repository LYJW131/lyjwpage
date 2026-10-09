import assert from "node:assert/strict";
import test from "node:test";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { withRequestState } from "@shared/request-state";
import { prepareIngest } from "@shared/ingest/prepare";
import { questMirror, questNow, QUEST_STALE_MS } from "@shared/quest";
import { commitPreparedIngest } from "./ingest-handlers";
import { collectIngestEffects } from "./ingest-effects";

const NOW = 1_800_000_000_000;
const game = { name: "Beat Saber", platform: "meta_quest", applicationId: "123" };
const report = (observedAt = NOW, playing: unknown = game, discordStatus = "online") =>
  ({ version: 1, presence: { observedAt, discordStatus, playing } });

test("Quest prepare validates the platform and freshness, excludes Discord account data", async () => {
  const command = await prepareIngest("quest", { ...report(), profile: { id: "private" } }, NOW);
  assert.deepEqual(structuredClone(command), command);
  assert.equal(command.source, "quest");
  assert.equal("profile" in command, false);
  for (const invalid of [report(NOW, { ...game, platform: "ps5" }), report(NOW + 60_001), report(NOW, game, "unknown"), { version: 1, presence: { observedAt: NOW, discordStatus: "online" } }]) {
    await assert.rejects(prepareIngest("quest", invalid, NOW));
  }
  const offline = await prepareIngest("quest", report(NOW, game, "offline"), NOW);
  assert.equal(offline.source === "quest" && offline.presence.playing, null);
});

test("Quest commit persists heartbeats, ignores old reports and only pushes state changes", async () => {
  installStorageForTests(new FakeStorage());
  try {
    const commit = (raw: unknown, at: number) => withRequestState(async () => {
      const command = await prepareIngest("quest", raw, at);
      assert.notEqual(command.source, "server");
      return collectIngestEffects(() => commitPreparedIngest(command as Exclude<typeof command, { source: "server" }>));
    });
    const first = await commit(report(), NOW);
    assert.equal(first.ok, true);
    assert.equal(first.effects.filter((x) => x.kind === "event").length, 1);
    const tagsOf = (result: typeof first) => result.effects.flatMap((x) => (x.kind === "tags" ? x.tags : []));
    assert.deepEqual(tagsOf(first), ["quest-now"], "开始玩：首页的卡片要出现");
    const heartbeat = await commit(report(NOW + 60_000), NOW + 60_000);
    assert.equal(heartbeat.effects.length, 0);
    assert.equal((await questMirror.get())?.observedAt, NOW + 60_000);
    await commit(report(NOW, null), NOW + 70_000);
    assert.equal((await questMirror.get())?.playing?.name, "Beat Saber");
    const stopped = await commit(report(NOW + 80_000, null), NOW + 80_000);
    assert.equal(stopped.effects.filter((x) => x.kind === "event").length, 1);
    assert.deepEqual(tagsOf(stopped), ["quest-now"], "停玩：首页的卡片要收起");
    assert.equal((await questMirror.get())?.playing, null);
    const recovered = await commit(report(NOW + 80_000 + QUEST_STALE_MS), NOW + 80_000 + QUEST_STALE_MS);
    assert.equal(recovered.effects.filter((x) => x.kind === "event").length, 1);
  } finally { resetStorageForTests(); }
});

test("Quest current state distinguishes no data, known idle and stale activity", () => {
  assert.equal(questNow(null, NOW).available, false);
  const presence = { observedAt: NOW, receivedAt: NOW, discordStatus: "online" as const, playing: null };
  assert.equal(questNow(presence, NOW).available, true);
  assert.deepEqual(questNow(presence, NOW + QUEST_STALE_MS), { observedAt: NOW, receivedAt: NOW, playing: null, available: false });
  assert.equal("discordStatus" in questNow(presence, NOW), false, "Discord 账号的在线状态不对外");
  assert.equal(questNow({ ...presence, observedAt: NOW - QUEST_STALE_MS }, NOW).available, false);
});
