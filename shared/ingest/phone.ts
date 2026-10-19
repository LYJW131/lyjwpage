import { object } from "@shared/json";
import type { ReportedWorkouts } from "@shared/types";
import type { ActivityReport } from "@shared/activity";
import { focusModeOf, type FocusMode } from "@shared/focus";

import { normalizeActivity } from "./activity";
import { normalizeWorkouts } from "./workouts";

// iPhone App 由 HealthKit 唤醒，不常驻；不能照搬 Mac 心跳来推断手机在线状态。

const KNOWN_MODULES = new Set(["activity", "workouts", "focus"]);

type PhoneEnvelope = {
  version?: unknown;
  modules?: unknown;
};

export type PreparedPhoneEnvelope = {
  source: "iphone";
  receivedAt: number;
  ignored: string[];
  workouts?: ReportedWorkouts;
  activity?: ActivityReport;
  focus?: { mode: FocusMode | null; observedAt: number };
  failure?: { stage: "beforeWorkouts" | "beforeActivity" | "beforeFocus"; message: string };
};

export function preparePhoneEnvelope(input: unknown, receivedAt = Date.now()): PreparedPhoneEnvelope {
  const envelope = object(input) as PhoneEnvelope | null;
  if (!envelope || envelope.version !== 1) {
    throw new Error("手机遥测协议 version 必须为 1");
  }
  if (envelope.modules != null && !object(envelope.modules)) {
    throw new Error("手机遥测请求的 modules 必须是对象");
  }
  const modules = object(envelope.modules) ?? {};
  const prepared: PreparedPhoneEnvelope = {
    source: "iphone",
    receivedAt,
    ignored: Object.keys(modules).filter((name) => !KNOWN_MODULES.has(name)),
  };
  if ("workouts" in modules) {
    try { prepared.workouts = normalizeWorkouts(modules.workouts, receivedAt); }
    catch (error) {
      prepared.failure = {
        stage: "beforeWorkouts",
        message: error instanceof Error ? error.message : String(error),
      };
      return prepared;
    }
  }
  if ("activity" in modules) {
    try { prepared.activity = normalizeActivity(modules.activity, receivedAt); }
    catch (error) {
      prepared.failure = {
        stage: "beforeActivity",
        message: error instanceof Error ? error.message : String(error),
      };
      return prepared;
    }
  }
  if ("focus" in modules) {
    try { prepared.focus = normalizeFocus(modules.focus, receivedAt); }
    catch (error) {
      prepared.failure = {
        stage: "beforeFocus",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return prepared;
}

// 快捷指令「获取当前专注模式」在关闭时给空串，切到别的模式时给那个模式的名字，两种都记成不在专注里。
function normalizeFocus(input: unknown, receivedAt: number): { mode: FocusMode | null; observedAt: number } {
  const focus = object(input);
  if (!focus) throw new Error("专注模式上报的 focus 必须是对象");
  const mode = focus.mode ?? "";
  if (typeof mode !== "string") throw new Error("专注模式上报的 mode 必须是字符串");
  return { mode: focusModeOf(mode), observedAt: receivedAt };
}
