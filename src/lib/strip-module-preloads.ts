const MODULE_PRELOAD = /<link rel="modulepreload"[^>]*>/g;

// 整份模块图（二十几个块、几百 KB）一起预载，会跟首屏的封面图抢带宽，LCP 被推到 JS 之后。
// 只留 <script type="module"> 里那两条路由 import，其余由浏览器按 import 关系自己走，首帧之后再取。
export function stripModulePreloads(html: string): string {
  return html.replace(MODULE_PRELOAD, "");
}
