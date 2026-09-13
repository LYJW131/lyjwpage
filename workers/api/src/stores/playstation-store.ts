import type {
  PlaystationPlayingPayload,
  PlaystationPowerPayload,
  PlaystationPresencePayload,
  TrophiesPayload,
} from "@/lib/types";
import { playedGamesMirror, powerMirror, presenceMirror, trophiesMirror } from "@shared/playstation-store";

export function setPlaystationPresence(payload: PlaystationPresencePayload) {
  return presenceMirror.put(payload);
}

export function setPlaystationPower(payload: PlaystationPowerPayload) {
  return powerMirror.put(payload);
}

export function setPlaystationPlayedGames(payload: PlaystationPlayingPayload) {
  return playedGamesMirror.put(payload);
}

export function setPlaystationTrophies(payload: TrophiesPayload) {
  return trophiesMirror.put(payload);
}
