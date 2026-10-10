import { loadLag, type LagResult } from "@/lib/lag-result";
import { LAG_KEYS, type GenshinProfile } from "@shared/lag";

export const GENSHIN_UID_PATTERN = /^\d{9,10}$/;

export const ENKA_TIMEOUT_MS = 10_000;

const ENKA_USER_AGENT = "lyjwpage-collector (+https://lyjw.me)";

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// Enka 转发的是 protobuf 解码结果，值为 0 的字段会被省略，计数缺省按 0 处理。
export function mapGenshinPlayerInfo(body: unknown): GenshinProfile {
  const info = (body as { playerInfo?: unknown } | null)?.playerInfo as Record<string, unknown> | undefined;
  if (!info || typeof info !== "object") throw new Error("Enka response has no playerInfo");
  if (typeof info.nickname !== "string" || !finite(info.level)) throw new Error("Enka playerInfo is malformed");
  const count = (value: unknown) => (finite(value) ? value : 0);
  return {
    nickname: info.nickname,
    adventureRank: info.level,
    worldLevel: count(info.worldLevel),
    achievements: count(info.finishAchievementNum),
    abyss: finite(info.towerFloorIndex) && finite(info.towerLevelIndex)
      ? { floor: info.towerFloorIndex, chamber: info.towerLevelIndex }
      : null,
    theaterAct: finite(info.theaterActIndex) ? info.theaterActIndex : null,
  };
}

// 错误信息不带请求地址：地址里有 UID，而 UID 不进日志。
export async function fetchGenshinProfile(
  uid: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = ENKA_TIMEOUT_MS,
): Promise<GenshinProfile> {
  const response = await fetcher(`https://enka.network/api/uid/${uid}?info`, {
    headers: { "User-Agent": ENKA_USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Enka responded ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Enka returned malformed JSON");
  }
  return mapGenshinPlayerInfo(body);
}

export function abyssLabel(abyss: GenshinProfile["abyss"]): string {
  return abyss ? `${abyss.floor}-${abyss.chamber}` : "—";
}

export function getGenshinProfile(): Promise<LagResult<GenshinProfile>> {
  return loadLag<GenshinProfile>(LAG_KEYS.genshin, "Waiting for the first Genshin Impact profile");
}
