import assert from "node:assert/strict";
import { test } from "node:test";
import { judgeRegion } from "./region-check.ts";

const clean = JSON.stringify({ ok: true, issues: [] });

test("completed run with clean result and screenshot passes", () => {
  assert.deepEqual(judgeRegion("completed", clean, 100), { ok: true, issues: [], unreachable: [] });
});

test("unreachable hosts are reported without failing the region", () => {
  const r = judgeRegion("completed", JSON.stringify({ ok: true, issues: [], unreachable: ["image.api.playstation.com"] }), 100);
  assert.equal(r.ok, true);
  assert.deepEqual(r.unreachable, ["image.api.playstation.com"]);
});

test("reported issues fail the region", () => {
  const r = judgeRegion("completed", JSON.stringify({ ok: false, issues: [{ where: "PlayStation", what: "broken art" }] }), 100);
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].where, "PlayStation");
});

test("missing screenshot fails even when the agent says ok", () => {
  const r = judgeRegion("completed", clean, 0);
  assert.equal(r.ok, false);
  assert.match(r.issues[0].what, /screenshot/);
});

test("missing, malformed or incomplete result.json fails", () => {
  for (const json of [undefined, "{", JSON.stringify({ ok: true })]) assert.equal(judgeRegion("completed", json, 100).ok, false);
});

test("a turn that did not complete fails", () => {
  assert.equal(judgeRegion("failed", clean, 100).ok, false);
});
