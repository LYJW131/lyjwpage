import { object } from "@/lib/json";
import type { WorkoutsPayload } from "@/lib/types";
import type { ActivityReport } from "@shared/activity";

import { normalizeActivity } from "./activity";
import { normalizeWorkouts } from "./workouts";

// iPhone App 由 HealthKit 唤醒，不常驻；不能照搬 Mac 心跳来推断手机在线状态。

const KNOWN_MODULES = new Set(["activity", "workouts"]);

type PhoneEnvelope = {
  version?: unknown;
  modules?: unknown;
};

export type PreparedPhoneEnvelope = {
  source: "iphone";
  receivedAt: number;
  ignored: string[];
  workouts?: WorkoutsPayload;
  activity?: ActivityReport;
  failure?: { stage: "beforeWorkouts" | "beforeActivity"; message: string };
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
    }
  }
  return prepared;
}
