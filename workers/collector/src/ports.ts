import { installAppleMusicAuth } from "@shared/apple-music-auth";
import { appleMusicCredentialsResult } from "@shared/credentials";
import { installStorage } from "@shared/storage";

import { appleDeveloperToken } from "./apple-developer-token";
import { currentEnv } from "./runtime";
import { collectorStorage } from "./storage-driver";

export function installCollectorPorts(): void {
  installStorage(collectorStorage);
  installAppleMusicAuth({
    developerToken: appleDeveloperToken,
    credentials: () => appleMusicCredentialsResult(currentEnv().CREDENTIALS),
  });
}
