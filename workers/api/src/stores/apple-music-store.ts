import type { ListeningItem, ListeningPayload, PlayingContainer } from "@/lib/types";
import { mirror, playingContainer } from "@shared/apple-music-store";

function sameContent(a: ListeningItem[], b: ListeningItem[]) {
  return JSON.stringify(a) === JSON.stringify(b);
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
