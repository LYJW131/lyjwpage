import { type EmbyNowPlaying, type StoredWatchingItem, currentMirror, imagesMirror, mirror, resumeMirror } from "@shared/emby-store";

export async function setNowPlaying(state: EmbyNowPlaying) {
  await mirror.put(state);
}

export async function clearNowPlaying() {
  await mirror.drop();
}

export async function setResume(items: StoredWatchingItem[]) {
  await resumeMirror.put({ items, at: Date.now() });
}

export async function setCurrentItem(item: StoredWatchingItem) {
  await currentMirror.put({ item, at: Date.now() });
}

const IMAGE_LIMIT = 96;

export async function setImageObjectKeys(
  objectKeys: Record<string, string>,
): Promise<Record<string, string>> {
  const entries = Object.entries(objectKeys).slice(-IMAGE_LIMIT);
  const trimmed = Object.fromEntries(entries);
  await imagesMirror.put({ objectKeys: trimmed, at: Date.now() });
  return trimmed;
}
