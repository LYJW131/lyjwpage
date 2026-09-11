import { mirrorKey } from "@/lib/storage";

/**
 * Mac 上报器推来的 Apple Music 凭据 —— 只有 music user token。
 *
 * developer token 由 api Worker 用自己的私钥现签（见 workers/api/src/musickit-token.ts
 * 的 issueApiDeveloperToken），不再从上报器收。从前两个 token 各自判变、各自可选，
 * 这里还要把缺省字段和旧值合并；现在只剩一个字段，收到什么存什么。
 */
export type StoredAppleMusicCredentialState = {
  musicUserToken: string;
  /** 收到的时刻，Unix 毫秒 */
  receivedAt: number;
};

export const mirror = mirrorKey<StoredAppleMusicCredentialState>(
  ["apple-music", "credentials"],
  (value) => value.receivedAt,
);
