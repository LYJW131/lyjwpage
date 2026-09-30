
import type { PlaystationPresencePayload } from "./types.ts";

export const PLAYSTATION_PRESENCE_KINDS = ["online", "busy", "offline"] as const;
export type PlaystationPresenceKind = (typeof PLAYSTATION_PRESENCE_KINDS)[number];

export function playstationPresenceKind(
  presence: Pick<PlaystationPresencePayload, "online" | "availability"> | undefined,
): PlaystationPresenceKind | null {
  if (!presence) return null;
  switch (presence.availability) {
    case "availableToPlay":
      return "online";
    case "doNotDisturb":
      return "busy";
    case "unavailable":
      return "offline";
    default:
      return presence.online ? "online" : "offline";
  }
}
