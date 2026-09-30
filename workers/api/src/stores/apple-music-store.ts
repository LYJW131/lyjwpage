import type { ListeningItem, ListeningPayload } from "@/lib/types";
import { mirror } from "@shared/apple-music-store";

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
