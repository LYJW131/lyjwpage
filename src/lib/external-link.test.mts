import assert from "node:assert/strict";
import test from "node:test";

import { describeExternalLink } from "./external-link.ts";

const describe = (href: string) => describeExternalLink(new URL(href));

test("GitHub links name the page kind and repository", () => {
  assert.equal(describe("https://github.com/LYJW131/lyjwpage/commit/371d16bafc5265853afb20e8eee8fae7e78cabba"), "Commit 371d16b in the lyjwpage repository on GitHub");
  assert.equal(describe("https://github.com/LYJW131/lyjwpage/tree/main/reporters/server-reporter"), "Source of server-reporter in the lyjwpage repository on GitHub");
  assert.equal(describe("https://github.com/LYJW131/lyjwpage/issues/12"), "Issue #12 in the lyjwpage repository on GitHub");
  assert.equal(describe("https://github.com/LYJW131/lyjwpage"), "The lyjwpage repository on GitHub");
  assert.equal(describe("https://github.com/grokkybara[bot]"), "grokkybara[bot]'s profile on GitHub");
});

test("known hosts get a site name, unknown hosts fall back to the host", () => {
  assert.equal(describe("https://music.apple.com/cn/album/x/1490256978?i=1490256995"), "This song on Apple Music");
  assert.equal(describe("https://music.apple.com/cn/album/x/1490256978"), "This album on Apple Music");
  assert.equal(describe("https://dash.cloudflare.com/209f2c881b1c494fec50851c067b3266/workers/services/view/ai/production"), "The ai Worker in the Cloudflare dashboard (sign-in required)");
  assert.equal(describe("https://status.claude.com/"), "Service status page on status.claude.com");
  assert.equal(describe("https://example.org/a"), "A page on example.org");
});
