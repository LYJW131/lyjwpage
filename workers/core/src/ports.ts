import { installLagReader, readLag } from "@shared/lag";
import { installStorage } from "@shared/storage";

import { currentContext } from "./runtime";
import { stateStorage } from "./storage-driver";

export function installApiPorts(): void {
  installStorage(stateStorage);
  installLagReader(async (key) => {
    const kv = currentContext().env.LAG;
    return kv ? readLag(kv, key) : null;
  });
}
