export function gamingSummaryDetail(activeSeconds: number, titles: number, states: readonly number[]): string {
  if (titles > 0) return `${titles.toLocaleString("en-US")} ${titles === 1 ? "game" : "games"}`;
  if (activeSeconds > 0) return "in game";
  return states.some((state) => state >= 1) ? "online" : "offline";
}
