import assert from "node:assert/strict";
import test from "node:test";

import { buildReviewSummary } from "./build-review-summary.ts";

test("the observed Claude review shows only its conclusion", () => {
  assert.equal(buildReviewSummary("## Code review\n\nNo issues found. Checked for bugs and CLAUDE.md compliance."), "No issues");
});

test("formatted conclusions and issue counts produce compact labels", () => {
  assert.equal(buildReviewSummary("<!-- review -->\r\n## Code review\r\n\r\n**No issues found.**"), "No issues");
  assert.equal(buildReviewSummary("## Code review\n\nFound 2 issues:\n\n1. **Missing check**"), "Issues found");
  assert.equal(buildReviewSummary("## Code review\n\n**Found 1 bug:** Missing check."), "Issues found");
  assert.equal(buildReviewSummary("### Issues found\n\nSee inline comments."), "Issues found");
});

test("missing, failed, and unfamiliar reviews never imply a clean review", () => {
  for (const body of [undefined, "", "unknown", "## Code review", "Review failed: timed out.", "Review suggests improvements.", "Found 0 issues so far; review incomplete.", "No issues found in the UI, but the server has a bug."]) {
    assert.equal(buildReviewSummary(body), "Unknown", body);
  }
});

test("quoted examples and buried phrases are not review conclusions", () => {
  for (const body of ["## Code review\n\n> No issues found.", "## Code review\n\n```text\nNo issues found.\n```\nReview failed.", "Checking whether there are issues found in this change.", "Review failed. No issues found."]) {
    assert.equal(buildReviewSummary(body), "Unknown", body);
  }
});
