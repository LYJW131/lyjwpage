import type { TrophiesPayload } from "@shared/types";

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

// 本地场景把整份奖杯目录注入到这个查询下，任何 ?titleids= 请求都从它切；客户端预取会把可见瓷砖并成一个批量查询，组合事先无法枚举。
export const TROPHY_CATALOG_OVERRIDE_SEARCH = "?titleids=*";
