import { object } from "@/lib/json";
import type { WorkoutsPayload } from "@/lib/types";
import type { ActivityReport } from "@shared/activity";

import { normalizeActivity } from "./activity";
import { normalizeWorkouts } from "./workouts";

/**
 * iPhone 上报器（lyjwpage iOS App）的信封。
 *
 * 和 Mac 那套（lib/telemetry 的 v4 信封）是同一个骨架：一个入口、一个版本号、
 * 一个 `modules` 字典，只带这次真的变了的模块。上报器那侧见
 * `apps/ios`。
 *
 * **骨架照抄，字段不照抄。** Mac 那份还带 `heartbeatAt` / `presence` /
 * `activeModules`，这里一个都没有 —— 它们在那边成立是因为 Mac 上跑的是个常驻
 * 进程：心跳能证明它还活着，activeModules 能让充电头在没有新读数时继续续命。
 * iPhone 上这个 App 平时**根本不在运行**，是 HealthKit 有新数据时才把它拉起来
 * （而且按小时节流）。照搬那三个字段只会让站点以为自己能判断手机在不在线 ——
 * 判不了。所以这条链路上没有存活、没有心跳，卡片的新鲜度只看「最近更新过没有」。
 *
 * 版本号从 1 起，不是接着 Mac 的 4：两套协议各活各的，共用一个号只会让人以为
 * 改一边要跟着改另一边。
 */

/** 站点认得的模块名。和 `/api/status/*` 的主题同名：`activity` ↔ /api/status/activity */
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
