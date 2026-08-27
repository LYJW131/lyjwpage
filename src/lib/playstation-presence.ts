/**
 * PlayStation 在线状态：读 presence.availability，不是 online 布尔。
 *
 * 上游 basicPresence.availability 已见三档，和 PSN 自己的绿 / 黄 / 灰对得上。
 * 缺席或未知时退回 online 布尔，不断言第三种。
 */

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
