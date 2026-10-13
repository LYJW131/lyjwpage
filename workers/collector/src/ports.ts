import { installAppleCache } from "@shared/apple-cache";
import { installAppleMusicAuth } from "@shared/apple-music-auth";
import { appleMusicCredentialsResult } from "@shared/credentials";
import { issueApiDeveloperToken } from "@shared/musickit-token";
import { installStorage } from "@shared/storage";

import { currentEnv } from "./runtime";
import { collectorStorage } from "./storage-driver";

export function installCollectorPorts(): void {
  installStorage(collectorStorage);
  installAppleCache(() => currentEnv().APPLE_CACHE ?? null);
  installAppleMusicAuth({
    developerToken: async () => (await issueApiDeveloperToken(currentEnv())).token,
    credentials: () => appleMusicCredentialsResult(currentEnv().CREDENTIALS),
  });
}
