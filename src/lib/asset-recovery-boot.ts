import { DOCUMENT_COMMIT_META } from "@/lib/app-version";

export const ASSET_RECOVERY_KEY = "lyjw:asset-recovery:v2";

// 同一版本的页面在这段时间内只自救一次：刷回来还是坏的（真坏了的部署、断网）就停在原地，不刷成环。
// 账按版本分别记，边缘缓存在两个旧版本间来回时也只各救一次。
export const ASSET_RECOVERY_COOLDOWN_MS = 5 * 60_000;

export const ASSET_RECOVERY_FETCH_TIMEOUT_MS = 4_000;

// iOS Safari 恢复被回收的后台标签时按缓存优先取回旧 HTML，它引用的带指纹资源在新版本部署后已 404，
// 样式表没了，首页那些 inset-0 的图片就按视口铺满整屏。资源加载失败时先把 HTTP 缓存里的这页换成新的，再刷新一次。
// 必须放在 <Links /> 之前：捕获阶段的 error 监听要先于样式表与 modulepreload 注册。
// 内联模块脚本的依赖图取不到时 error 派发在 <script> 上；模块运行时抛错只到 window，不会误触发。
export function assetRecoveryScript(): string {
  const key = JSON.stringify(ASSET_RECOVERY_KEY);
  const meta = JSON.stringify(`meta[name="${DOCUMENT_COMMIT_META}"]`);
  return (
    `(function(){var d=document,f=false,g=false;` +
    `function own(u){try{var x=new URL(u,location.href);return x.origin===location.origin&&x.pathname.indexOf("/assets/")===0}catch(e){return false}}` +
    `function go(){if(g)return;g=true;location.reload()}` +
    `function recover(){if(f||navigator.onLine===false)return;f=true;` +
    `var m=d.querySelector(${meta}),c=m?m.getAttribute("content")||"":"",n=Date.now();` +
    `function live(t){return typeof t==="number"&&n-t>=0&&n-t<${ASSET_RECOVERY_COOLDOWN_MS}}` +
    `try{var p=JSON.parse(sessionStorage.getItem(${key})||"{}"),q={};if(!p||typeof p!=="object")p={};` +
    `for(var k in p)if(Object.prototype.hasOwnProperty.call(p,k)&&live(p[k]))q[k]=p[k];if(q[c]!==undefined)return;q[c]=n;` +
    `var raw=JSON.stringify(q);sessionStorage.setItem(${key},raw);if(sessionStorage.getItem(${key})!==raw)return}catch(e){return}` +
    `var t=setTimeout(go,${ASSET_RECOVERY_FETCH_TIMEOUT_MS});` +
    `fetch(location.href,{cache:"reload",credentials:"same-origin"}).then(function(r){return r.text()})` +
    `.catch(function(){}).then(function(){clearTimeout(t);go()})}` +
    `addEventListener("error",function(e){var l=e.target;` +
    `if(!l)return;if(l.tagName==="LINK"&&(l.rel==="stylesheet"||l.rel==="modulepreload")&&own(l.href))recover();` +
    `else if(l.tagName==="SCRIPT"&&l.type==="module"&&(!l.src||own(l.src)))recover()},true);` +
    `addEventListener("load",function(){var s=d.querySelectorAll('link[rel="stylesheet"]');` +
    `for(var i=0;i<s.length;i++)if(own(s[i].href)&&!s[i].sheet)recover()})})();`
  );
}
