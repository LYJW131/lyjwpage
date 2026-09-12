import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSiteActivity } from "./site-activity.ts";
import type { VercelDeployment } from "./vercel-deployments-types.ts";
const deploy = (id: string, sha: string, createdAt: number, state: VercelDeployment['state'] = "READY"): VercelDeployment => ({ id, state, createdAt, target: "production", buildDurationMs: 1000, commit: { sha, branch: "main", message: sha } });
test("the same commit and its deployment retries occupy one row without losing current production", () => {
  const production = deploy("live", "aaa", 1);
  const rows = mergeSiteActivity([{ sha: "aaa", shortSha: "aaa", title: "GitHub title", url: "https://github.com/o/r/commit/aaa", authorLogin: "o", committedAt: null }], { fetchedAt: 3, production, recent: [deploy("retry", "aaa", 2, "ERROR"), production] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "GitHub title");
  assert.equal(rows[0].deployment?.id, "retry");
  assert.equal(rows[0].production, true);
});
test("an older rollback stays visible with the latest four other commits", () => {
  const production = deploy("live", "old", 1);
  const rows = mergeSiteActivity([], { fetchedAt: 10, production, recent: Array.from({ length: 6 }, (_, i) => deploy(String(i), String(i), i + 2)) });
  assert.equal(rows.length, 5);
  assert.equal(rows[0].sha, "old");
  assert.equal(rows[1].at, 7);
});
test("commits without deployment data remain ordinary commits", () => {
  const rows = mergeSiteActivity([{ sha: "abc", shortSha: "abc", title: "A commit", url: "https://github.com/o/r/commit/abc", authorLogin: null, committedAt: null }], undefined);
  assert.equal(rows[0].production, false);
  assert.equal(rows[0].deployment, null);
});
