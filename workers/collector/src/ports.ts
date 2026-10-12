import { installAppleMusicAuth } from "@shared/apple-music-auth";
import { appleMusicCredentialsResult } from "@shared/credentials";

import { appleDeveloperToken } from "./apple-developer-token";
import { currentEnv } from "./runtime";

export function installCollectorPorts(): void {
  installAppleMusicAuth({
    developerToken: appleDeveloperToken,
    credentials: () => appleMusicCredentialsResult(currentEnv().CREDENTIALS),
  });
}
