import { scriptJson } from "@/lib/inline-script";

// 须与 src/app/styles/utilities.css 里的 html.offscreen-revealed 同步。
export const OFFSCREEN_REVEALED_CLASS = "offscreen-revealed";

// 交给 <ScrollRestoration storageKey>；启动脚本按 react-router 存的 { [history.state.key]: scrollY } 读同一份。
export const SCROLL_POSITIONS_KEY = "lyjwpage-scroll-positions";

// 屏外卡片的 contain-intrinsic-size 只是估值：刷新或返回会恢复到页面中间时，视口上方的卡片从估值换成真实高度，
// 视口里的内容跟着上下跳（WebKit 没有滚动锚定，Chromium 也补不全）。会恢复到非顶部的那次加载，首帧前就撤掉占位。
export function offscreenRestoreScript(): string {
  return (
    `try{var k=history.state&&history.state.key,` +
    `y=k&&JSON.parse(sessionStorage.getItem(${scriptJson(SCROLL_POSITIONS_KEY)})||"{}")[k];` +
    `if(y>0)document.documentElement.classList.add(${scriptJson(OFFSCREEN_REVEALED_CLASS)})}catch(e){}`
  );
}
