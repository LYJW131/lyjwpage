import assert from "node:assert/strict";
import test from "node:test";

import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";
import { HIDDEN_DESKTOP_BUNDLE_ID } from "@shared/types";
import { mirror as telemetryMirror } from "@shared/telemetry";

import { type CollectedIngest } from "./ingest-effects";
import { prepareIngest as prepareShared, type CoreCommand } from "@shared/ingest/prepare";
import { type ImageBucket } from "@shared/ingest/r2-assets";
import type { PreparedTelemetryEnvelope } from "@shared/ingest/telemetry";
import { type Env } from "./runtime";
import { NOW, commit, envelope, inRequest, testEnv } from "./testing/ingest-harness";

function prepareIngest(source: string, body: unknown, at: number, images: ImageBucket = { head: async () => ({}) }): Promise<CoreCommand> {
  return prepareShared(source, body, at, images) as Promise<CoreCommand>;
}

function desktopPush(result: CollectedIngest<unknown>) {
  const effect = result.effects.find(
    (item) => item.kind === "event" && item.event.type === "desktop",
  );
  if (!(effect?.kind === "event" && effect.event.type === "desktop")) {
    throw new Error("没有推送 desktop 事件");
  }
  const { desktop } = effect.event.payload;
  if (!desktop) throw new Error("desktop 推送里没有前台应用");
  return desktop;
}

async function landDesktop(env: Env, desktop: Record<string, unknown>) {
  const command = await inRequest(env, () =>
    prepareIngest("mac", envelope({ desktop }, ["desktop"]), NOW));
  const result = await commit(env, command);
  return { command, result };
}

test("desktop 的窗口标题入库并随推送发出", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  try {
    const { result } = await landDesktop(env, {
      applicationName: "Ghostty",
      bundleIdentifier: "com.mitchellh.ghostty",
      windowTitle: "  ~/Developer/lyjwpage — zsh  ",
      observedAt: NOW,
    });
    assert.equal(result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, "~/Developer/lyjwpage — zsh");
    assert.equal(desktopPush(result).windowTitle, "~/Developer/lyjwpage — zsh");
  } finally { installTestStorage(null); }
});

test("desktop 缺席或空白的窗口标题一律是 null，不是缺字段", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  try {
    const blank = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: "   ",
      observedAt: NOW,
    });
    assert.equal(blank.result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, null);
    const blankPush = desktopPush(blank.result);
    assert.equal(blankPush.windowTitle, null);
    assert.ok("windowTitle" in blankPush);

    const absent = await landDesktop(env, { applicationName: "Ghostty", observedAt: NOW + 1 });
    assert.equal(absent.result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, null);
    const absentPush = desktopPush(absent.result);
    assert.equal(absentPush.windowTitle, null);
    assert.ok("windowTitle" in absentPush);
  } finally { installTestStorage(null); }
});

test("desktop 的超长窗口标题按码点截断，不劈开代理对", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  try {
    const { result } = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: "🎬".repeat(250),
      observedAt: NOW,
    });
    assert.equal(result.ok, true);
    const stored = (await telemetryMirror.get())?.desktop?.windowTitle;
    assert.equal(stored, "🎬".repeat(200));
    assert.equal([...(stored ?? "")].length, 200);
    assert.equal(desktopPush(result).windowTitle, stored);

    const exact = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: "标".repeat(200),
      observedAt: NOW + 1,
    });
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, "标".repeat(200));
    assert.equal(desktopPush(exact.result).windowTitle, "标".repeat(200));
  } finally { installTestStorage(null); }
});

test("desktop 的窗口标题类型不对时该模块及其后的模块都不落地", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  try {
    const { command, result } = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: 42,
      observedAt: NOW,
    });
    assert.equal((command as PreparedTelemetryEnvelope).failure?.stage, "beforeDesktop");
    assert.equal(result.ok, false);
    assert.equal(await telemetryMirror.get(), null);
    assert.equal(result.effects.some((effect) =>
      effect.kind === "event" && effect.event.type === "desktop"), false);
  } finally { installTestStorage(null); }
});

test("隐藏前台应用时窗口标题被强制清空", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  try {
    const { result } = await landDesktop(env, {
      applicationName: "Hidden",
      bundleIdentifier: HIDDEN_DESKTOP_BUNDLE_ID,
      windowTitle: "私密项目 — 不该出现在站点上",
      observedAt: NOW,
    });
    assert.equal(result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, null);
    assert.equal(desktopPush(result).windowTitle, null);
  } finally { installTestStorage(null); }
});
