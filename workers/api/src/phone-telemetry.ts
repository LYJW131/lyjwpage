import { writeWorkouts } from "@api/stores/workouts";
import { fanout } from "@api/fanout";
import { writeActivity } from "@api/stores/activity";
import type { PreparedPhoneEnvelope } from "@shared/ingest/phone";

export async function commitPreparedPhoneEnvelope(prepared: PreparedPhoneEnvelope) {

  const writes: Promise<unknown>[] = [];
  const { ignored } = prepared;
  let accepted = 0;

  // 后续模块失败时，finally 仍须等待此前已启动的写入，避免已接受数据无人确认。
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
    await fanout({ writes });
  }

  return { accepted, ignored };
}
