import { scriptJson } from "@/lib/inline-script";

// 须与 src/app/styles/utilities.css 里的 html.offscreen-revealed 同步。
export const OFFSCREEN_REVEALED_CLASS = "offscreen-revealed";

// react-router <ScrollRestoration> 的默认存储键，存的是 { [history.state.key]: scrollY }；升级 react-router 时核对一次。
export const SCROLL_POSITIONS_KEY = "react-router-scroll-positions";

// 屏外卡片的 contain-intrinsic-size 只是估值：刷新或返回会恢复到页面中间时，视口上方的卡片从估值换成真实高度，
// 视口里的内容跟着上下跳（WebKit 没有滚动锚定，Chromium 也补不全）。会恢复到非顶部的那次加载，首帧前就撤掉占位。
export function offscreenRestoreScript(): string {
  return (
    `try{var k=history.state&&history.state.key,` +
    `y=k&&JSON.parse(sessionStorage.getItem(${scriptJson(SCROLL_POSITIONS_KEY)})||"{}")[k];` +
    `if(y>0)document.documentElement.classList.add(${scriptJson(OFFSCREEN_REVEALED_CLASS)})}catch(e){}`
  );
}

type BootGlobals = Pick<typeof globalThis, "history" | "sessionStorage" | "document">;

export function syncOffscreenToDocument({ history, sessionStorage, document }: BootGlobals = globalThis): void {
  try {
    const key: unknown = history.state?.key;
    const y: unknown = typeof key === "string" ? JSON.parse(sessionStorage.getItem(SCROLL_POSITIONS_KEY) || "{}")[key] : null;
    if (typeof y === "number" && y > 0) document.documentElement.classList.add(OFFSCREEN_REVEALED_CLASS);
  } catch {}
}
