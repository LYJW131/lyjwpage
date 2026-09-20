/**
 * Quest 连上来的 Playing，`application_id` 经常是 Meta 那个壳，不是游戏。
 * Discord 客户端点进去走的是游戏自己的应用（detectable / parent）。
 */

import { applicationRpc } from "./application-cover.js";
import { foldGameName, isPlatformShell, pickGameApplicationId } from "./game-name.js";

export { foldGameName, pickGameApplicationId } from "./game-name.js";

const USER_AGENT = "DiscordBot (https://lyjw.me, 0.1.0)";

let names: Map<string, string> | null = null;
let loading: Promise<Map<string, string>> | null = null;

async function detectableIndex(): Promise<Map<string, string>> {
  if (names) return names;
  if (loading) return loading;
  loading = (async () => {
    const response = await fetch("https://discord.com/api/v10/applications/detectable", {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`detectable ${response.status}`);
    const list = (await response.json()) as Array<{
      id?: unknown;
      name?: unknown;
      aliases?: unknown;
    }>;
    const map = new Map<string, string>();
    for (const item of list) {
      if (typeof item.id !== "string" || typeof item.name !== "string") continue;
      const folded = foldGameName(item.name);
      if (folded && !map.has(folded)) map.set(folded, item.id);
      if (!Array.isArray(item.aliases)) continue;
      for (const alias of item.aliases) {
        if (typeof alias !== "string") continue;
        const foldedAlias = foldGameName(alias);
        if (foldedAlias && !map.has(foldedAlias)) map.set(foldedAlias, item.id);
      }
    }
    names = map;
    return map;
  })();
  try {
    return await loading;
  } finally {
    if (!names) loading = null;
  }
}

async function detectableIdByName(name: string): Promise<string | null> {
  const folded = foldGameName(name);
  if (!folded) return null;
  try {
    return (await detectableIndex()).get(folded) ?? null;
  } catch {
    return null;
  }
}

export async function resolveGameApplicationId(input: {
  name: string;
  applicationId: string | null;
  parentApplicationId: string | null;
}): Promise<string | null> {
  if (input.parentApplicationId) return input.parentApplicationId;

  let applicationName: string | null | undefined = undefined;
  if (input.applicationId) {
    const rpc = await applicationRpc(input.applicationId);
    applicationName = rpc ? rpc.name : undefined;
  }

  const needsCatalog = !input.applicationId || isPlatformShell(applicationName);
  const detectableId = needsCatalog ? await detectableIdByName(input.name) : null;
  return pickGameApplicationId({
    ...input,
    applicationName,
    detectableId,
  });
}
