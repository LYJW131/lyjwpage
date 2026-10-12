import { mirrorKey } from "@shared/storage";
import type { ReporterPresence } from "@/lib/types";


export type Liveness = Pick<ReporterPresence, "lastSeenAt" | "declaredOffline">;

export const mirror = mirrorKey<Liveness>(
  ["reporter", "liveness"],
);
