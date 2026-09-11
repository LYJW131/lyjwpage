import { mirror } from "@shared/apple-music-credentials";

/** 只有一个字段，收到什么存什么；没有旧值要合并 */
export async function putAppleMusicCredentials(update: { musicUserToken: string; receivedAt: number }): Promise<void> {
  await mirror.put(update);
}
