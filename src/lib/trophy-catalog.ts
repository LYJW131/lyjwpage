import type { Cache, ScopedMutator } from "swr";

import { trophiesTilePath } from "@/lib/paths";
import { PLAYSTATION_IMAGE_SCALE, playstationImage } from "@/lib/playstation-image";
import { fetchStatus } from "@/lib/status-reads";
import { sliceTrophies } from "@/lib/trophy-slice";
import type { StatusResponse, TrophiesPayload } from "@/lib/types";

type Catalog = StatusResponse<TrophiesPayload>;

export const TROPHY_VISIBLE_ROWS = 5;
const TROPHY_ICON_PX = 44;
const WARM_GROUP_COUNT = 3;

export function trophyIconSrc(url: string): string {
  return playstationImage(url, TROPHY_ICON_PX * PLAYSTATION_IMAGE_SCALE) ?? url;
}

// 切片耗时几乎全在服务端读整份奖杯数据，与切几款无关，所以多块瓷砖并成一次请求。
const pending = new Map<string, Promise<Catalog>>();

export function fetchCatalog(key: string): Promise<Catalog> {
  const batched = pending.get(key);
  if (!batched) return fetchStatus<TrophiesPayload>(key);
  pending.delete(key);
  return batched.catch(() => fetchStatus<TrophiesPayload>(key));
}

function cachedCatalog(cache: Cache, key: string): Catalog | undefined {
  return cache.get(key)?.data as Catalog | undefined;
}

// 直接写缓存而不挂 useSWR：推送的 trophies 事件只重取已挂载的键，预取的切片不会被成批重拉；
// 展开时 useSWR 先用缓存出图，再照常在挂载时重验。
export function prefetchCatalogs(
  tiles: readonly (readonly string[])[],
  cache: Cache,
  mutate: ScopedMutator,
): Promise<void> | null {
  const wanted = tiles
    .map((titleIds) => ({ titleIds, key: trophiesTilePath(titleIds) }))
    .filter(({ key }) => !pending.has(key) && !cachedCatalog(cache, key));
  if (!wanted.length) return null;

  const batch = fetchStatus<TrophiesPayload>(
    trophiesTilePath([...new Set(wanted.flatMap(({ titleIds }) => titleIds))]),
  );
  const settled = wanted.map(({ titleIds, key }) => {
    const slice = batch.then((envelope): Catalog => {
      if (!envelope.ok) throw new Error(envelope.error);
      return { ...envelope, data: sliceTrophies(envelope.data, titleIds) };
    });
    pending.set(key, slice);
    return slice.then(
      (envelope) => {
        if (pending.get(key) !== slice) return;
        pending.delete(key);
        if (!cachedCatalog(cache, key)) void mutate(key, envelope, { revalidate: false });
      },
      () => {
        if (pending.get(key) === slice) pending.delete(key);
      },
    );
  });
  return Promise.all(settled).then(() => {});
}

function firstScreenIcons(payload: TrophiesPayload): string[] {
  const trophies = payload.titles
    .flatMap((title) => title.trophies)
    .slice(0, TROPHY_VISIBLE_ROWS)
    .filter((trophy) => trophy.earned || !trophy.hidden)
    .map((trophy) => trophy.iconUrl);
  const groups = payload.titles
    .flatMap((title) => (title.groups.length > 1 ? title.groups : []))
    .slice(0, WARM_GROUP_COUNT)
    .map((group) => group.iconUrl);
  return [...trophies, ...groups]
    .filter((url): url is string => Boolean(url))
    .map(trophyIconSrc);
}

// 持有引用，免得预热的图在展开前被内存缓存回收。
const warmed = new Map<string, HTMLImageElement>();

function warmIcons(envelope: Catalog): void {
  if (!envelope.ok) return;
  for (const url of firstScreenIcons(envelope.data)) {
    if (warmed.has(url)) continue;
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    warmed.set(url, image);
  }
}

export function warmTrophyIcons(titleIds: readonly string[], cache: Cache): void {
  const key = trophiesTilePath(titleIds);
  const cached = cachedCatalog(cache, key);
  if (cached) {
    warmIcons(cached);
    return;
  }
  pending.get(key)?.then(warmIcons, () => {});
}
