export const CHAT_CONSENT_KEY = "lyjw.chat.consent";
// 构建期由 next.config.ts 按对话相关代码的内容哈希注入，代码一变旧的同意就失效。
export const CHAT_CONSENT_VERSION = process.env.CHAT_CODE_VERSION ?? "";

export type ChatConsentLanguage = "zh" | "en";

// 按访客这条消息判断：含汉字算中文，但日文也用汉字，见到假名就不算；其余语言一律英文。
export function chatConsentLanguage(text: string): ChatConsentLanguage {
  return /\p{Script=Han}/u.test(text) && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? "zh" : "en";
}

type ConsentStorage = Pick<Storage, "getItem" | "setItem">;

export function acceptedChatConsent(raw: string | null, version: string): boolean {
  if (!raw) return false;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && (value as { version?: unknown }).version === version;
  } catch {
    return false;
  }
}

export function createChatConsentStore(storage: () => ConsentStorage | null, version: string, now = () => Date.now()) {
  // 存不进浏览器（隐私模式、配额满）时这一页内仍记住已同意，免得每条消息都问。
  let acceptedInMemory = false;
  const listeners = new Set<() => void>();
  const read = () => {
    if (acceptedInMemory) return true;
    try { return acceptedChatConsent(storage()?.getItem(CHAT_CONSENT_KEY) ?? null, version); }
    catch { return false; }
  };
  return {
    getSnapshot: read,
    getServerSnapshot: () => false,
    subscribe(listener: () => void) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => { if (event.key === CHAT_CONSENT_KEY || event.key === null) listener(); };
      window.addEventListener("storage", onStorage);
      return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
    },
    accept() {
      acceptedInMemory = true;
      try { storage()?.setItem(CHAT_CONSENT_KEY, JSON.stringify({ version, acceptedAt: now() })); }
      catch {}
      listeners.forEach((listener) => listener());
    },
  };
}

export const chatConsent = createChatConsentStore(() => typeof window === "undefined" ? null : window.localStorage, CHAT_CONSENT_VERSION);
