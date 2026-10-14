import type { PlaystationGame } from "@shared/types";

// 同名同图的 SKU（PS4 / PS5 版）在游戏墙上合成一块瓷砖，奖杯明细按这块瓷砖的全部 titleId 查。
export function variantLook(game: Pick<PlaystationGame, "name" | "imageUrl">): string {
  return `${game.name}\n${game.imageUrl ?? ""}`;
}

export function variantGroups(games: readonly Pick<PlaystationGame, "titleId" | "name" | "imageUrl">[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const game of games) {
    const look = variantLook(game);
    groups.set(look, [...(groups.get(look) ?? []), game.titleId]);
  }
  return [...groups.values()];
}
