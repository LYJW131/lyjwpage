import assert from "node:assert/strict";
import test from "node:test";

import { BUILD_ISSUE_ORIGIN, BUILD_ISSUE_URL_LIMIT, BUILD_REPO, buildIssueUrl, type BuildPlan } from "@shared/build-routine";

test("buildIssueUrl opens the improvement form with every field prefilled", () => {
  const plan: BuildPlan = {
    title: "Support dark mode for status bar",
    spec: "Add dark mode styles to status bar component.",
    acceptance: ["Dark mode activates properly", "Contrast meets WCAA AA".replace("WCAA", "WCAG")],
    paths: ["src/components/status-bar.tsx"],
  };

  const urlString = buildIssueUrl(plan);
  const url = new URL(urlString);

  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, `/${BUILD_REPO}/issues/new`);
  assert.equal(url.searchParams.get("template"), "improvement.yml");
  assert.equal(url.searchParams.get("title"), plan.title);
  assert.equal(url.searchParams.get("what"), plan.spec);
  assert.equal(url.searchParams.get("acceptance"), "- [ ] Dark mode activates properly\n- [ ] Contrast meets WCAG AA");
  assert.equal(url.searchParams.get("paths"), "- `src/components/status-bar.tsx`");
  const context = url.searchParams.get("context") ?? "";
  assert.ok(context.includes("_Filed from the [homepage chat](https://lyjw.me)._"));
  assert.ok(context.includes(`<!-- ${BUILD_ISSUE_ORIGIN} -->`));
});

test("buildIssueUrl keeps localized footer in context", () => {
  const zhPlan: BuildPlan = {
    title: "在移动端适配播放器列表吸附",
    spec: "修复移动端播放器列表吸附对齐问题。",
    acceptance: ["列表吸附对齐整行", "滚动条隐藏"],
    paths: ["src/components/player.tsx"],
  };

  const zhUrl = new URL(buildIssueUrl(zhPlan));
  assert.equal(zhUrl.searchParams.get("title"), zhPlan.title);
  assert.equal(zhUrl.searchParams.get("what"), zhPlan.spec);
  assert.ok((zhUrl.searchParams.get("context") ?? "").includes("_提交自[首页对话](https://lyjw.me)。_"));
});

test("buildIssueUrl stays under the limit for maximum-size plans", () => {
  const huge: BuildPlan = {
    title: "t".repeat(100),
    spec: "规".repeat(6000),
    acceptance: Array.from({ length: 8 }, (_, i) => `验收${i}`.repeat(75)),
    paths: Array.from({ length: 30 }, (_, i) => `src/components/${i}/`.repeat(5)),
  };
  const urlString = buildIssueUrl(huge);
  assert.ok(urlString.length <= BUILD_ISSUE_URL_LIMIT, `url is ${urlString.length} chars`);
  const url = new URL(urlString);
  assert.ok((url.searchParams.get("what") ?? "").endsWith("…"));
  assert.equal(url.searchParams.get("acceptance"), "…");
  assert.equal(url.searchParams.get("paths"), "…");
});
