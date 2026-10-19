import assert from "node:assert/strict";
import test from "node:test";
import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";
import { withRequestState } from "@shared/request-state";
import { prepareIngest, type CoreCommand } from "@shared/ingest/prepare";
import { FOCUS_MAX_MS, focusMirror, focusNow } from "@shared/focus";
import { commitPreparedIngest } from "./ingest-handlers";
import { collectIngestEffects } from "./ingest-effects";

const NOW = 1_800_000_000_000;
const report = (mode: unknown) => ({ version: 1, modules: { focus: { mode } } });

test("focus keeps sleep and mindfulness only, keeps since across repeats, tags only when the card shows or hides", async () => {
  installTestStorage(new FakeStorage());
  try {
    const commit = (mode: unknown, at: number) => withRequestState(async () => {
      const command = await prepareIngest("iphone", report(mode), at) as CoreCommand;
      return collectIngestEffects(() => commitPreparedIngest(command));
    });
    const tagsOf = (result: Awaited<ReturnType<typeof commit>>) => result.effects.flatMap((x) => (x.kind === "tags" ? x.tags : []));

    assert.deepEqual(tagsOf(await commit("睡眠", NOW)), ["focus-now"]);
    assert.deepEqual(tagsOf(await commit("睡眠", NOW + 60_000)), []);
    assert.equal((await focusMirror.get())?.since, NOW);
    assert.deepEqual(tagsOf(await commit("正念", NOW + 120_000)), [], "换模式不改首页布局，交给推送");
    assert.deepEqual(focusNow(await focusMirror.get(), NOW + 120_000), { mode: "mindfulness", since: NOW + 120_000, observedAt: NOW + 120_000 });
    assert.deepEqual(tagsOf(await commit("工作", NOW + 180_000)), ["focus-now"], "别的专注模式不公开");
    assert.equal((await focusMirror.get())?.mode, null);
    await commit("Sleep", NOW + 240_000);
    assert.equal(focusNow(await focusMirror.get(), NOW + 240_000 + FOCUS_MAX_MS).mode, null, "关闭那一封丢了也会收起");
    assert.deepEqual(tagsOf(await commit("", NOW + 300_000)), ["focus-now"]);
    await assert.rejects(prepareIngest("iphone", report(3), NOW).then((c) => commitPreparedIngest(c as CoreCommand)));
  } finally {
    installTestStorage(null);
  }
});
