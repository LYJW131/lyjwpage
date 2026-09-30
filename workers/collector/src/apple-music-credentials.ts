import { appleMusicCredentialsResult, type AppleMusicCredentialsResult } from "@shared/credentials";

import { currentEnv } from "./runtime";

export async function readAppleMusicCredentials(): Promise<AppleMusicCredentialsResult> {
  return appleMusicCredentialsResult(currentEnv().CREDENTIALS);
}
