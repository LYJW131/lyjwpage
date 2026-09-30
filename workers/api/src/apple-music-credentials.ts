import { appleMusicCredentialsResult, type AppleMusicCredentialsResult } from "@shared/credentials";
import { currentContext } from "./runtime";

export async function readAppleMusicCredentials(): Promise<AppleMusicCredentialsResult> {
  return appleMusicCredentialsResult(currentContext().env.CREDENTIALS);
}
