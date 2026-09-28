import { mirror } from "@shared/apple-music-credentials";
import { readAppleMusicCredentialsFrom, writeAppleMusicCredentials } from "@shared/credentials";
import { withRequestState } from "@shared/request-state";
import { requestStore, type Env } from "./runtime";

/**
 * 临时：Apple Music user token 从 StateHub 的 SQLite 挪到凭据 KV。
 *
 * Mac 只在令牌变了时才推，不能等它自己补上。KV 里已有就什么都不做；搬完删掉
 * SQLite 那份，之后每分钟只剩一次 KV 读。生产搬完后随下一次清理连同
 * shared/apple-music-credentials.ts 一起删除。
 */
export async function migrateAppleMusicCredentials(env: Env, ctx: ExecutionContext): Promise<void> {
  const kv = env.CREDENTIALS;
  if (!kv || await readAppleMusicCredentialsFrom(kv)) return;
  await withRequestState(() => requestStore.run({ env, ctx }, async () => {
    const stored = await mirror.get();
    if (!stored?.musicUserToken) return;
    await writeAppleMusicCredentials(kv, { musicUserToken: stored.musicUserToken, receivedAt: stored.receivedAt });
    await mirror.drop();
    console.log("[credentials] Apple Music user token moved to KV");
  }));
}
