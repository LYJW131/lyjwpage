import { key, withRedis } from "@/lib/redis";

/**
 * Mac 上报器送来的 Apple Music 凭据。
 *
 * 存在的理由是不想把 .p8 私钥放到服务器上。签名密钥留在那台 Mac 的钥匙串里由
 * 系统保管，这边只拿一份由 MusicKit 现签的 developer token，加上同一次授权产出
 * 的 music user token。代价是这份会过期 —— 上报器按 `expiresAt` 在到期前重签
 * 重发，这边只负责收下最新的一份。
 *
 * 严格和 telemetryState 分开存。那份东西最终会经 /api/status/* 发到浏览器，
 * 凭据一旦沾上那条路就是迟早泄露。这里的读取只发生在服务端调 Apple 的时候。
 */
export type StoredAppleMusicCredentials = {
  musicUserToken: string;
  developerToken: string;
  /** developer token 的到期时刻，Unix 秒。上报器从 token 自己的 JWT 里解出来的 */
  expiresAt: number;
  /** 收到的时刻，Unix 毫秒 */
  receivedAt: number;
};

const K = key("apple-music", "credentials");

/** 没配 Redis 时退回进程内存。重启就没了，届时等上报器下一次续期补上 */
let memory: StoredAppleMusicCredentials | null = null;

export async function putAppleMusicCredentials(
  credentials: StoredAppleMusicCredentials,
): Promise<void> {
  memory = credentials;
  await withRedis(async (redis) => {
    await redis.set(K, JSON.stringify(credentials));
  }, undefined);
}

export async function getAppleMusicCredentials(): Promise<StoredAppleMusicCredentials | null> {
  /**
   * 包一层再返回，是为了把「Redis 说没有」和「Redis 用不了」分开。
   *
   * withRedis 的 fallback 只在后者触发，但内层直接返回 null 的话两种情况在外面
   * 长得一模一样，就只能一律退回进程内存 —— 那样从 Redis 里删掉的凭据还会从
   * 内存里活过来，实测踩到过。
   */
  const answered = await withRedis(async (redis) => {
    const raw = await redis.get(K);
    return { value: raw ? (JSON.parse(raw) as StoredAppleMusicCredentials) : null };
  }, null);
  if (answered) {
    // Redis 是权威：它说没有就是没有，顺手把内存里那份也丢掉
    if (!answered.value) memory = null;
    return answered.value;
  }
  return memory;
}
