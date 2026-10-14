import assert from "node:assert/strict";
import test from "node:test";

import { waitForSiteVersion } from "./wait-site-version.ts";

const EXPECTED = "a".repeat(40);
const OLDER = "b".repeat(40);
const NEWER = "c".repeat(40);
const SOURCE = "https://lyjw.me";
const EDGE = "https://lyjw131.com";

type Verdict = boolean | null | undefined;

function harness(served: Record<string, (string | null)[]>, ancestry: Record<string, Verdict | (() => Verdict)> = {}) {
  const calls = { served: [] as string[], ancestor: [] as [string | undefined, string][], sleeps: 0 };
  const queues = Object.fromEntries(Object.entries(served).map(([origin, list]) => [origin, [...list]]));
  return {
    calls,
    options: {
      origins: Object.keys(served),
      expected: EXPECTED,
      attempts: 4,
      intervalMs: 1,
      servedCommit: async (origin: string) => {
        calls.served.push(origin);
        const queue = queues[origin];
        return (queue.length > 1 ? queue.shift() : queue[0]) ?? null;
      },
      isAncestor: async (base: string | undefined, head: string) => {
        calls.ancestor.push([base, head]);
        const verdict = ancestry[head];
        return (typeof verdict === "function" ? verdict() : verdict) ?? null;
      },
      sleep: async () => {
        calls.sleeps += 1;
      },
    },
  };
}

test("依次等每个域名换上这次的 sha，旧提交只比较一次", async () => {
  const { calls, options } = harness(
    { [SOURCE]: [OLDER, OLDER, EXPECTED], [EDGE]: [null, "not-a-sha", EXPECTED] },
    { [OLDER]: false },
  );
  assert.deepEqual(await waitForSiteVersion(options), { status: "live" });
  assert.deepEqual(calls.served, [SOURCE, SOURCE, SOURCE, EDGE, EDGE, EDGE]);
  assert.deepEqual(calls.ancestor, [[EXPECTED, OLDER]]);
  assert.equal(calls.sleeps, 4);
});

test("域名已答出更新的后代提交时立即让位，不再等后面的域名", async () => {
  const { calls, options } = harness({ [SOURCE]: [OLDER, NEWER], [EDGE]: [EXPECTED] }, { [OLDER]: false, [NEWER]: true });
  assert.deepEqual(await waitForSiteVersion(options), { status: "superseded", origin: SOURCE, commit: NEWER });
  assert.deepEqual(calls.served, [SOURCE, SOURCE]);
});

test("等满次数仍不是这次的 sha 就超时，报出最后看到的提交", async () => {
  const { calls, options } = harness({ [SOURCE]: [EXPECTED], [EDGE]: [OLDER] }, { [OLDER]: false });
  assert.deepEqual(await waitForSiteVersion(options), { status: "timeout", origin: EDGE, commit: OLDER });
  assert.equal(calls.served.filter((origin) => origin === EDGE).length, 4);
  assert.equal(calls.sleeps, 3);
});

test("比较失败不缓存，下一轮重试", async () => {
  const verdicts = [null, true];
  const { calls, options } = harness({ [SOURCE]: [NEWER] }, { [NEWER]: () => verdicts.shift() });
  assert.deepEqual(await waitForSiteVersion(options), { status: "superseded", origin: SOURCE, commit: NEWER });
  assert.equal(calls.ancestor.length, 2);
});
