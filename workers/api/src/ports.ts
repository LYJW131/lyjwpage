import { installAppleCache } from "@shared/apple-cache";
import { installAppleMusicAuth } from "@shared/apple-music-auth";
import { appleMusicCredentialsResult } from "@shared/credentials";
import { installLagReader, readLag } from "@shared/lag";
import { issueApiDeveloperToken } from "@shared/musickit-token";
import { installStorage } from "@shared/storage";

import { currentContext } from "./runtime";
import { stateStorage } from "./storage-driver";

export function installApiPorts(): void {
  installStorage(stateStorage);
  installLagReader(async (key) => {
    const kv = currentContext().env.LAG;
    return kv ? readLag(kv, key) : null;
  });
  installAppleCache(() => currentContext().env.APPLE_CACHE ?? null);
  installAppleMusicAuth({
    developerToken: async () => (await issueApiDeveloperToken(currentContext().env)).token,
    credentials: () => appleMusicCredentialsResult(currentContext().env.CREDENTIALS),
  });
}
