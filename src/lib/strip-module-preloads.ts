const MODULE_PRELOAD = /<link rel="modulepreload"[^>]*>/g;
const ROUTE_BOOT = /<script type="module" async="">([\s\S]*?)<\/script>/;

// 整份模块图（二十几个块、几百 KB）一起预载，会跟首屏的封面图抢带宽，LCP 被推到 JS 之后。
export function stripModulePreloads(html: string): string {
  return html.replace(MODULE_PRELOAD, "");
}

// React Router 的路由 import 在解析到内联 module 脚本时就开跑。改成 load 之后再执行：
// 首帧只等 HTML、字体和首屏图，路由块和水合都排到 load 之后。
export function deferRouteBoot(html: string): string {
  const match = ROUTE_BOOT.exec(html);
  if (!match) return html;
  const boot = `<script type="text/plain" data-route-boot>${match[1]}</script>` +
    `<script>(function(){var run=function(){var t=document.querySelector("script[data-route-boot]");if(!t)return;var s=document.createElement("script");s.type="module";s.textContent=t.textContent;t.replaceWith(s)};if(document.readyState==="complete")run();else window.addEventListener("load",run,{once:true})})()</script>`;
  return html.slice(0, match.index) + boot + html.slice(match.index + match[0].length);
}
