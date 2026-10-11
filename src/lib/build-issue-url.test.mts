import assert from "node:assert/strict";
import test from "node:test";

import { BUILD_REPO, buildIssueUrl, type BuildPlan } from "@shared/build-routine";

test("buildIssueUrl constructs standard GitHub issues new URL with prefilled title and body", () => {
  const plan: BuildPlan = {
    title: "Support dark mode for status bar",
    spec: "Add dark mode styles to status bar component.",
    acceptance: ["Dark mode activates properly", "Contrast meets WCAG AA"],
    paths: ["src/components/status-bar.tsx"],
  };

  const urlString = buildIssueUrl(plan);
  const url = new URL(urlString);

  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, `/${BUILD_REPO}/issues/new`);
  assert.equal(url.searchParams.get("title"), plan.title);

  const body = url.searchParams.get("body") ?? "";
  assert.ok(body.includes(plan.spec));
  assert.ok(body.includes("## Acceptance criteria"));
  assert.ok(body.includes("- [ ] Dark mode activates properly"));
  assert.ok(body.includes("## Planned paths"));
  assert.ok(body.includes("- `src/components/status-bar.tsx`"));
  assert.ok(body.includes("_Filed from the [homepage chat](https://lyjw.me)._"));
});

test("buildIssueUrl handles Chinese and Japanese copy correctly", () => {
  const zhPlan: BuildPlan = {
    title: "在移动端适配播放器列表吸附",
    spec: "修复移动端播放器列表吸附对齐问题。",
    acceptance: ["列表吸附对齐整行", "滚动条隐藏"],
    paths: ["src/components/player.tsx"],
  };

  const zhUrl = new URL(buildIssueUrl(zhPlan));
  assert.equal(zhUrl.searchParams.get("title"), zhPlan.title);
  const zhBody = zhUrl.searchParams.get("body") ?? "";
  assert.ok(zhBody.includes("## 验收标准"));
  assert.ok(zhBody.includes("## 计划路径"));
  assert.ok(zhBody.includes("_提交自[首页对话](https://lyjw.me)。_"));
});
