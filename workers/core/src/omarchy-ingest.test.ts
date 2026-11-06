import assert from "node:assert/strict";
import test from "node:test";

import { prepareIngest } from "@shared/ingest/prepare";
import type { CoreCommand } from "@shared/ingest/prepare";
import { omarchyMirror } from "@shared/omarchy";
import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";

import { NOW, commit, inRequest, testEnv } from "./testing/ingest-harness";

function body(applicationName: string | null, observedAt: number) {
  return { version: 1, observedAt, modules: { desktop: applicationName ? { applicationName } : null } };
}

test("omarchy 只存最新一份，不推送、不失效缓存，旧的观测不覆盖新的", async () => {
  installTestStorage(new FakeStorage());
  const env = testEnv();
  try {
    const land = async (name: string | null, observedAt: number) => {
      const command = await prepareIngest("omarchy", body(name, observedAt), NOW) as CoreCommand;
      return commit(env, command);
    };
    const first = await land("Ghostty", NOW - 2_000);
    assert.equal(first.ok, true);
    assert.deepEqual(first.effects, []);
    assert.equal((await inRequest(env, () => omarchyMirror.get()))?.desktop?.applicationName, "Ghostty");

    await land("Chromium", NOW - 5_000);
    assert.equal((await inRequest(env, () => omarchyMirror.get()))?.desktop?.applicationName, "Ghostty");

    await land(null, NOW - 1_000);
    assert.equal((await inRequest(env, () => omarchyMirror.get()))?.desktop, null);
  } finally { installTestStorage(null); }
});
