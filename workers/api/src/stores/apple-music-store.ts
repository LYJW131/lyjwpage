import type { ListeningItem, ListeningPayload, PlayingContainer } from "@/lib/types";
import { mirror, playingContainer } from "@shared/apple-music-store";

function sameContent(a: ListeningItem[], b: ListeningItem[]) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// 首项动态封面这次没查出结果（motion 为 undefined）时沿用同一项已存的那份，一次查询失败不算列表变化。
function keepFirstMotion(items: ListeningItem[], stored: ListeningItem | undefined): ListeningItem[] {
  const [first, ...rest] = items;
  if (!first || first.motion !== undefined || !stored || stored.id !== first.id) return items;
  return [{ ...first, motion: stored.motion }, ...rest];
}

export async function prepareRecentlyPlayed(
  items: ListeningItem[],
  fetchedAt = Date.now(),
): Promise<{
  changed: boolean;
  listening: ListeningPayload;
  commit: () => Promise<void>;
}> {
  const previous = await mirror.get();
  items = keepFirstMotion(items, previous?.items[0]);
  const changed = !previous || !sameContent(previous.items, items);

  return {
    changed,
    listening: { items, fetchedAt },
    commit: async () => {
      await mirror.put({ items, fetchedAt });
    },
  };
}

export async function preparePlayingContainer(
  container: PlayingContainer | null,
  fetchedAt = Date.now(),
): Promise<{ changed: boolean; commit: () => Promise<void> }> {
  const previous = await playingContainer.get();
  const changed = !previous || JSON.stringify(previous.container) !== JSON.stringify(container);
  return { changed, commit: () => playingContainer.put({ container, fetchedAt }) };
}
