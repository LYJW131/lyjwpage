/**
 * 共享凭据：KV 命名空间 `lyjwpage-credentials`（binding `CREDENTIALS`）。
 *
 * 和可滞后层分开一个命名空间：公开状态端点的读路径（api 的 `src/lag-store.ts`）只碰 `LAG`，
 * 键表写错也漏不出这里的东西。api 同时绑着两个 KV，隔离靠代码路径，不靠绑定。
 * 写入方是上报入口（Mac 推来的 Apple Music user token），读取方是采集 Worker
 * （拉最近在听）和状态核心的歌词、曲目查询。
 */

export const CREDENTIAL_KEYS = {
  /** Mac 上报器推来的 Apple Music user token */
  appleMusic: "apple-music:v1",
} as const;

export type StoredAppleMusicCredentials = {
  musicUserToken: string;
  /** 收到的时刻，epoch 毫秒 */
  receivedAt: number;
};

/** 两种拿不到，修法相反：一个去看 KV，一个去 Mac 上授权 */
export type AppleMusicCredentialsResult =
  | { ok: true; credentials: StoredAppleMusicCredentials }
  | { ok: false; reason: "storage-unreachable" | "never-pushed" };

export interface CredentialStore {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export async function readAppleMusicCredentialsFrom(kv: CredentialStore): Promise<StoredAppleMusicCredentials | null> {
  const raw = await kv.get(CREDENTIAL_KEYS.appleMusic, "text");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAppleMusicCredentials>;
    return typeof parsed.musicUserToken === "string" && parsed.musicUserToken && typeof parsed.receivedAt === "number"
      ? { musicUserToken: parsed.musicUserToken, receivedAt: parsed.receivedAt }
      : null;
  } catch {
    return null;
  }
}

export async function writeAppleMusicCredentials(kv: CredentialStore, value: StoredAppleMusicCredentials): Promise<void> {
  await kv.put(CREDENTIAL_KEYS.appleMusic, JSON.stringify(value));
}

/** 读凭据 KV 并带上原因；没绑 KV、读失败都算不可达 */
export async function appleMusicCredentialsResult(kv: CredentialStore | undefined): Promise<AppleMusicCredentialsResult> {
  if (!kv) return { ok: false, reason: "storage-unreachable" };
  try {
    const credentials = await readAppleMusicCredentialsFrom(kv);
    return credentials ? { ok: true, credentials } : { ok: false, reason: "never-pushed" };
  } catch {
    return { ok: false, reason: "storage-unreachable" };
  }
}
