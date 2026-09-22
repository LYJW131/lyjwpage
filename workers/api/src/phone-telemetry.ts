import { normalizeWorkouts, writeWorkouts } from "@api/stores/workouts";
import { STATUS_VIEWS } from "@/lib/status-views";
import { object } from "@/lib/json";
import { ACTIVITY_TAG } from "@/lib/live-events";
import { fanout } from "@api/fanout";
import { normalizeActivity, writeActivity } from "@api/stores/activity";
import type { StoredActivity } from "@shared/activity";
import type { WorkoutsPayload } from "@/lib/types";

/**
 * iPhone 遥测中心的信封。
 *
 * 和 Mac 那套（lib/telemetry 的 v4 信封）是同一个骨架：一个入口、一个版本号、
 * 一个 `modules` 字典，只带这次真的变了的模块。上报器那侧见
 * `reporters/iphone-telemetry-hub`。
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
  activity?: StoredActivity;
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

export async function recordPhoneEnvelope(input: unknown, receivedAt = Date.now()) {
  return commitPreparedPhoneEnvelope(preparePhoneEnvelope(input, receivedAt));
}

export async function commitPreparedPhoneEnvelope(prepared: PreparedPhoneEnvelope) {

  const writes: Promise<unknown>[] = [];
  const tags: string[] = [];
  /**
   * 收到了但不认识的模块名，原样回给上报器。
   *
   * 上报器先于站点发版时（手机上装了带新模块的版本、站点还没部署），
   * 唯一看得见这件事的地方就是这个回执 —— 否则表现是「那份数据一直没出现」，
   * 而两边都不报错。
   */
  const { ignored } = prepared;
  let accepted = 0;

  /**
   * 模块处理包起来，是为了保证「已经发车的写」一定被交给 fanout。
   *
   * 眼下只有一个模块，这个 try 看着是多余的 —— 但它守的是加第二个模块那一天：
   * 那时一个模块校验失败中途抛出去，另一个已经发车的写就没人接管了，serverless
   * 上响应一返回随手就被掐掉。Mac 那侧踩过这个坑，见 lib/telemetry 里同样的形状。
   */
  try {
    if (prepared.failure?.stage === "beforeWorkouts") throw new Error(prepared.failure.message);
    if (prepared.workouts) {
      writes.push(writeWorkouts(prepared.workouts));
      tags.push(STATUS_VIEWS.workouts.tag);
      accepted += 1;
    }
    if (prepared.failure?.stage === "beforeActivity") throw new Error(prepared.failure.message);
    if (prepared.activity) {
      writes.push(writeActivity(prepared.activity));
      tags.push(ACTIVITY_TAG);
      accepted += 1;
    }
  } finally {
    // 不推送：圈以分钟为尺度涨，广播它就是拿推送当轮询用。只失效首屏那份缓存，
    // 卡片按自己的长间隔轮询 —— 见 lib/activity 的模块注释
    await fanout({ writes, tags });
  }

  return { accepted, ignored };
}
