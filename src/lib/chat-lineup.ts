import { GOD_CHAT_DEFAULT_LINEUP, isGodChatLineup, type GodChatLineup } from "@shared/god-chat-tiers";

const LINEUP_KEY = "lyjw.chat.lineup";

const listeners = new Set<() => void>();
// 存不进浏览器（隐私模式、配额满）时这一页内仍记住选择。
let chosenInMemory: GodChatLineup | null = null;

function read(): GodChatLineup {
  if (chosenInMemory) return chosenInMemory;
  try {
    const value = window.localStorage.getItem(LINEUP_KEY);
    return isGodChatLineup(value) ? value : GOD_CHAT_DEFAULT_LINEUP;
  } catch {
    return GOD_CHAT_DEFAULT_LINEUP;
  }
}

export const chatLineup = {
  getSnapshot: read,
  getServerSnapshot: (): GodChatLineup => GOD_CHAT_DEFAULT_LINEUP,
  subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => { if (event.key === LINEUP_KEY || event.key === null) { chosenInMemory = null; listener(); } };
    window.addEventListener("storage", onStorage);
    return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
  },
  choose(lineup: GodChatLineup) {
    chosenInMemory = lineup;
    try { window.localStorage.setItem(LINEUP_KEY, lineup); }
    catch {}
    listeners.forEach((listener) => listener());
  },
};
