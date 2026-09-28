import { writeWorkouts } from "@api/stores/workouts";
import { fanout } from "@api/fanout";
import { writeActivity } from "@api/stores/activity";
import type { PreparedPhoneEnvelope } from "@shared/ingest/phone";

/**
 * iPhone 遥测信封的状态核心那一半：Pulse 要的五分钟桶和训练区间。信封的收敛
 * （版本、模块、逐字段校验）在上报入口，见 shared/ingest/phone.ts。
 */
export async function commitPreparedPhoneEnvelope(prepared: PreparedPhoneEnvelope) {

  const writes: Promise<unknown>[] = [];
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
      accepted += 1;
    }
    if (prepared.failure?.stage === "beforeActivity") throw new Error(prepared.failure.message);
    if (prepared.activity) {
      writes.push(writeActivity(prepared.activity));
      accepted += 1;
    }
  } finally {
    // 状态核心这一半只有 Pulse 的输入，不推送、不失效首屏：圆环读数与训练列表这两份
    // 展示快照由上报入口在这之后写进可滞后层，首屏标签也由那边按布局判（见 workers/ingress 的 lag-ingest）。
    await fanout({ writes });
  }

  return { accepted, ignored };
}
