import assert from "node:assert/strict";
import { test } from "node:test";

import type { DigestOutcome, DigestRecord, DigestRequest } from "@shared/digest";
import { LAG_KEYS, readLag } from "@shared/lag";

import type { Env } from "../env";
import { MemoryKv } from "../testing/memory-kv";
import { digestJob, refreshDigest } from "./digest";

const now = 1_700_000_000_000;
const HOUR = 3_600_000;

function record(headline: string, inputHash: string, generatedAt: number): DigestRecord {
  const highlights = [{ topic: "coding", value: 22, unit: "hours", atLeast: false, caption: "coding" }, { topic: "music", value: 8, unit: "hours", atLeast: false, caption: "music" }] as const;
  return { headline, highlights: [...highlights], model: "claude-sonnet-5-5", generatedAt, inputHash };
}

function setup(outcomes: (DigestOutcome | Error)[]) {
  const lag = new MemoryKv();
  const revalidated: string[][] = [];
  const requests: DigestRequest[] = [];
  const core = { revalidate: async (tags: string[]) => { revalidated.push(tags); } };
  const digest = {
    compose: async (request: DigestRequest) => {
      requests.push(request);
      const next = outcomes.shift();
      if (!next || next instanceof Error) throw next ?? new Error("no outcome left");
      return next;
    },
  };
  return { lag, core, digest, revalidated, requests };
}

test("digest skips cleanly while ai has no model key or the binding is missing", async (t) => {
  t.mock.method(console, "warn", () => {});
  assert.deepEqual(await digestJob.run({ env: { LAG: new MemoryKv() } as unknown as Env, now, scheduled: true }), {
    status: "skipped",
    detail: "missing DIGEST",
  });
  const deps = setup([{ status: "unconfigured" }]);
  assert.deepEqual(await refreshDigest(deps, now), { status: "skipped", detail: "missing ANTHROPIC_API_KEY on ai" });
  assert.equal(deps.lag.puts.length, 0);
});

test("the first digest is written and revalidated; an unchanged hour only moves updatedAt", async () => {
  const first = record("Coding all day", "hash-1", now);
  const second = record("Coding, then Suisei", "hash-2", now + 2 * HOUR);
  const deps = setup([{ status: "composed", digest: first }, { status: "unchanged" }, { status: "composed", digest: second }]);

  assert.deepEqual(await refreshDigest(deps, now), { status: "ok", detail: "composed" });
  assert.deepEqual(await readLag(deps.lag, LAG_KEYS.digest), { updatedAt: now, data: first });
  assert.deepEqual(deps.revalidated, [["digest"]]);

  assert.deepEqual(await refreshDigest(deps, now + HOUR), { status: "ok", detail: "unchanged" });
  assert.deepEqual(await readLag(deps.lag, LAG_KEYS.digest), { updatedAt: now + HOUR, data: first });

  assert.deepEqual(await refreshDigest(deps, now + 2 * HOUR), { status: "ok", detail: "composed" });
  assert.deepEqual(await readLag(deps.lag, LAG_KEYS.digest), { updatedAt: now + 2 * HOUR, data: second });
  assert.deepEqual(deps.revalidated, [["digest"]], "only the first digest changes the page layout");
  assert.deepEqual(deps.requests.map((request) => request.previousInputHash), [null, "hash-1", "hash-1"]);
  assert.deepEqual(deps.requests.map((request) => request.previousHeadline), [null, "Coding all day", "Coding all day"]);
});

test("switching between a digest and a quiet day revalidates the page both ways", async () => {
  const busy = record("Coding all day", "hash-1", now);
  const quiet: DigestRecord = { headline: "", highlights: [], quiet: true, model: "claude-sonnet-5-5", generatedAt: now + HOUR, inputHash: "hash-2" };
  const stillQuiet: DigestRecord = { ...quiet, generatedAt: now + 2 * HOUR, inputHash: "hash-3" };
  const back = record("Back to coding", "hash-4", now + 3 * HOUR);
  const deps = setup([busy, quiet, stillQuiet, back].map((digest) => ({ status: "composed", digest })));

  for (const hour of [0, 1, 2, 3]) await refreshDigest(deps, now + hour * HOUR);
  assert.equal(deps.revalidated.length, 3, "first digest, digest → quiet and quiet → digest; quiet → quiet stays put");
  assert.deepEqual(await readLag(deps.lag, LAG_KEYS.digest), { updatedAt: now + 3 * HOUR, data: back });
});

test("a failed round keeps the last digest, and a failed revalidation does not fail the round", async (t) => {
  t.mock.method(console, "warn", () => {});
  const first = record("Coding all day", "hash-1", now);
  const deps = setup([{ status: "composed", digest: first }, new Error("model down")]);
  deps.core.revalidate = async () => { throw new Error("core down"); };

  assert.deepEqual(await refreshDigest(deps, now), { status: "ok", detail: "composed" });
  await assert.rejects(refreshDigest(deps, now + HOUR), /model down/);
  assert.deepEqual(await readLag(deps.lag, LAG_KEYS.digest), { updatedAt: now, data: first });
});
