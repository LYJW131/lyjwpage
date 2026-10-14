import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { AVATAR_URL, REDISPATCH_AFTER_MS, watchAvatar, type AvatarWatchDeps } from "./avatar-watch";

const AVATAR = new Uint8Array([1, 2, 3, 4]);
const AVATAR_HASH = createHash("sha256").update(AVATAR).digest("hex");

function harness(options: { marker: string; avatar?: Response; dispatchStatus?: number }) {
  const dispatched: RequestInit[] = [];
  const store = new Map<string, { value: string; ttlMs: number }>();
  const deps: AvatarWatchDeps = {
    token: "t",
    memo: {
      get: async (key) => store.get(key)?.value,
      put: async (key, value, ttlMs) => { store.set(key, { value, ttlMs }); },
    },
    fetch: async (input, init) => {
      const url = String(input);
      if (url === AVATAR_URL) return options.avatar ?? new Response(AVATAR, { headers: { "content-type": "image/jpeg" } });
      if (url.includes("/contents/.github/github-avatar.sha256?ref=main")) return new Response(`${options.marker}\n`);
      if (url.endsWith("/actions/workflows/avatar-sync.yml/dispatches")) {
        dispatched.push(init ?? {});
        return new Response(null, { status: options.dispatchStatus ?? 204 });
      }
      throw new Error(`unexpected fetch ${url}`);
    },
  };
  return { deps, dispatched, store };
}

test("matching marker does nothing", async () => {
  const { deps, dispatched } = harness({ marker: AVATAR_HASH });
  assert.deepEqual(await watchAvatar(deps), { status: "ok" });
  assert.equal(dispatched.length, 0);
});

test("changed avatar dispatches the workflow on main once per hash", async () => {
  const { deps, dispatched, store } = harness({ marker: "old" });
  assert.equal((await watchAvatar(deps)).detail, "dispatched");
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.method, "POST");
  assert.deepEqual(JSON.parse(String(dispatched[0]?.body)), { ref: "main" });
  assert.deepEqual([...store.values()], [{ value: AVATAR_HASH, ttlMs: REDISPATCH_AFTER_MS }]);

  assert.equal((await watchAvatar(deps)).detail, "dispatch pending");
  assert.equal(dispatched.length, 1);
});

test("a non-image avatar response fails instead of counting as a change", async () => {
  const redirect = new Response("<html>", { status: 302, headers: { "content-type": "text/html" } });
  const { deps, dispatched } = harness({ marker: AVATAR_HASH, avatar: redirect });
  await assert.rejects(watchAvatar(deps), /302/);
  assert.equal(dispatched.length, 0);
});

test("a rejected dispatch fails and is retried next round", async () => {
  const { deps, store } = harness({ marker: "old", dispatchStatus: 403 });
  await assert.rejects(watchAvatar(deps), /403/);
  assert.equal(store.size, 0);
});
