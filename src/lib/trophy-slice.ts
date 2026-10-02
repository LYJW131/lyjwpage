import type { TrophiesPayload } from "@/lib/types";

export function sliceTrophies(
  payload: TrophiesPayload,
  titleIds: readonly string[],
): TrophiesPayload {
  return {
    ...payload,
    titles: payload.titles.filter((title) =>
      title.titleIds.some((id) => titleIds.includes(id)),
    ),
  };
}
