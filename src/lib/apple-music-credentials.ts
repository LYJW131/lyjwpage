import { mirrorKey } from "@/lib/redis";

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

const mirror = mirrorKey<StoredAppleMusicCredentials>(
  ["apple-music", "credentials"],
  (value) => value.receivedAt,
);

export async function putAppleMusicCredentials(
  credentials: StoredAppleMusicCredentials,
): Promise<void> {
  await mirror.put(credentials);
}

/** null 有两种含义，调用方分不开也不需要分：都是「现在用不了」。见 readAppleMusicCredentials */
export async function getAppleMusicCredentials(): Promise<StoredAppleMusicCredentials | null> {
  return mirror.get();
}

/**
 * 带原因的读取。
 *
 * 「Redis 连不上」和「上报器还没授权过」都表现为拿不到凭据，但修法完全相反 ——
 * 前者去看 Redis，后者去点授权按钮。报错里指错方向会白白浪费一轮排查，实测
 * 遇到过：凭据明明在 Redis 里，只是容器重建那几秒断连，页面却说「去授权」。
 */
export async function readAppleMusicCredentials(): Promise<
  | { ok: true; credentials: StoredAppleMusicCredentials }
  | { ok: false; reason: "redis-unreachable" | "never-pushed" }
> {
  const credentials = await mirror.get();
  if (credentials) return { ok: true, credentials };
  return { ok: false, reason: (await mirror.reachable()) ? "never-pushed" : "redis-unreachable" };
}
