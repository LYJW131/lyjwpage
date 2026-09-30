// 凭据与公开状态分开命名空间，避免公开读取路径的键表错误泄露令牌。

export const CREDENTIAL_KEYS = {
  appleMusic: "apple-music:v1",
} as const;

export type StoredAppleMusicCredentials = {
  musicUserToken: string;
  receivedAt: number;
};

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

export async function appleMusicCredentialsResult(kv: CredentialStore | undefined): Promise<AppleMusicCredentialsResult> {
  if (!kv) return { ok: false, reason: "storage-unreachable" };
  try {
    const credentials = await readAppleMusicCredentialsFrom(kv);
    return credentials ? { ok: true, credentials } : { ok: false, reason: "never-pushed" };
  } catch {
    return { ok: false, reason: "storage-unreachable" };
  }
}
