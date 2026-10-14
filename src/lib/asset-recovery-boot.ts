import { DOCUMENT_COMMIT_META } from "@/lib/app-version";

export const ASSET_RECOVERY_KEY = "lyjw:asset-recovery:v1";

// 同一版本的页面在这段时间内只自救一次：刷回来还是坏的（真坏了的部署、断网）就停在原地，不刷成环。
export const ASSET_RECOVERY_COOLDOWN_MS = 5 * 60_000;

export const ASSET_RECOVERY_FETCH_TIMEOUT_MS = 4_000;

// iOS Safari 恢复被回收的后台标签时按缓存优先取回旧 HTML，它引用的带指纹资源在新版本部署后已 404，
// 样式表没了，首页那些 inset-0 的图片就按视口铺满整屏。资源加载失败时先把 HTTP 缓存里的这页换成新的，再刷新一次。
// 必须放在 <Links /> 之前：捕获阶段的 error 监听要先于样式表与 modulepreload 注册。
export function assetRecoveryScript(): string {
  const key = JSON.stringify(ASSET_RECOVERY_KEY);
  const meta = JSON.stringify(`meta[name="${DOCUMENT_COMMIT_META}"]`);
  return (
    `(function(){var d=document,f=false,g=false;` +
    `function own(u){try{return new URL(u,location.href).pathname.indexOf("/assets/")===0}catch(e){return false}}` +
    `function go(){if(g)return;g=true;location.reload()}` +
    `function recover(){if(f||navigator.onLine===false)return;f=true;` +
    `var m=d.querySelector(${meta}),c=m?m.getAttribute("content")||"":"",n=Date.now();` +
    `try{var p=JSON.parse(sessionStorage.getItem(${key})||"null");` +
    `if(p&&p.c===c&&n-p.t>=0&&n-p.t<${ASSET_RECOVERY_COOLDOWN_MS})return;` +
    `var raw=JSON.stringify({c:c,t:n});sessionStorage.setItem(${key},raw);if(sessionStorage.getItem(${key})!==raw)return}catch(e){return}` +
    `var t=setTimeout(go,${ASSET_RECOVERY_FETCH_TIMEOUT_MS});` +
    `fetch(location.href,{cache:"reload",credentials:"same-origin"}).then(function(r){return r.text()})` +
    `.catch(function(){}).then(function(){clearTimeout(t);go()})}` +
    `addEventListener("error",function(e){var l=e.target;` +
    `if(l&&l.tagName==="LINK"&&(l.rel==="stylesheet"||l.rel==="modulepreload")&&own(l.href))recover()},true);` +
    `addEventListener("load",function(){var s=d.querySelectorAll('link[rel="stylesheet"]');` +
    `for(var i=0;i<s.length;i++)if(own(s[i].href)&&!s[i].sheet)recover()})})();`
  );
}
