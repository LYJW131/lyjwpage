export const THEME_STORAGE_KEY = "theme";

export const THEME_CHOICES = ["light", "dark", "system"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type ResolvedTheme = "light" | "dark";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

type ThemeRoot = {
  classList: { remove(...tokens: string[]): void; add(...tokens: string[]): void; contains(token: string): boolean };
  dataset: Record<string, string | undefined>;
  style: { colorScheme: string };
};

export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === "system") return systemDark ? "dark" : "light";
  return choice;
}

export function themeMatchesRoot(root: ThemeRoot, choice: ThemeChoice, systemDark: boolean): boolean {
  const resolved = resolveTheme(choice, systemDark);
  return (
    root.dataset.themeChoice === choice &&
    root.style.colorScheme === resolved &&
    root.classList.contains(resolved) &&
    !root.classList.contains(resolved === "dark" ? "light" : "dark")
  );
}

export function applyThemeToRoot(root: ThemeRoot, choice: ThemeChoice, systemDark: boolean): void {
  const resolved = resolveTheme(choice, systemDark);
  root.dataset.themeChoice = choice;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}

// 与 applyThemeToRoot 逐项一致，由 theme.test.mts 对跑；首屏前同步执行，后面不能依赖任何模块。
export function themeBootScript(): string {
  return (
    `(function(){var d=document.documentElement,s=null;` +
    `try{s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}` +
    `var c=s==="light"||s==="dark"?s:"system",` +
    `r=c==="system"?(matchMedia(${JSON.stringify(SYSTEM_DARK_QUERY)}).matches?"dark":"light"):c;` +
    `d.dataset.themeChoice=c;d.classList.remove("light","dark");d.classList.add(r);d.style.colorScheme=r})();`
  );
}

export function readThemeChoice(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function readSystemDark(): boolean {
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

const listeners = new Set<() => void>();

export function subscribeThemeChoice(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function subscribeSystemDark(onStoreChange: () => void): () => void {
  const query = window.matchMedia(SYSTEM_DARK_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

// 切换主题时临时关掉全站过渡，否则各组件的颜色过渡会错开着变。
function withoutTransitions(change: () => void): void {
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(style);
  change();
  void getComputedStyle(document.body).opacity;
  setTimeout(() => style.remove(), 1);
}

export function syncThemeToDocument(choice: ThemeChoice, systemDark: boolean): void {
  const root = document.documentElement;
  if (themeMatchesRoot(root, choice, systemDark)) return;
  withoutTransitions(() => applyThemeToRoot(root, choice, systemDark));
}

export function setThemeChoice(next: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {}
  syncThemeToDocument(next, readSystemDark());
  for (const listener of listeners) listener();
}
