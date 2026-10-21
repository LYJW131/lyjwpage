import { scriptJson } from "@/lib/inline-script";

const MODULE_PRELOAD = /<link rel="modulepreload"[^>]*>/g;
// 浏览器把大写标签名，以及带空白、属性的结束标签，也当成 script。
const SCRIPT = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\b[^>]*>/gi;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function lowPriority(link: string): string {
  return /\sfetchpriority=/i.test(link) ? link : link.replace(/\s*(\/?>)$/, ' fetchpriority="low"$1');
}

function deferredScript(module: string, attributes: string, preloads: string): string | null {
  const attrs = [...attributes.matchAll(ATTRIBUTE)];
  const type = attrs.find((attr) => attr[1].toLowerCase() === "type");
  const value = type?.[3] ?? type?.[4] ?? type?.[5];
  if (value?.toLowerCase() !== "module" || !attrs.some((attr) => attr[1].toLowerCase() === "async") ||
      attrs.some((attr) => attr[1].toLowerCase() === "src") || !type) return null;
  const bootstrapAttributes = attributes.slice(0, type.index) + attributes.slice(type.index + type[0].length);
  return `<script${bootstrapAttributes}>(function(){` +
    `var b=document.currentScript,done=false,frame=0,timer=0,po=null,armed=false;` +
    `function start(){if(done)return;done=true;cancelAnimationFrame(frame);clearTimeout(timer);if(po)po.disconnect();document.removeEventListener("visibilitychange",visible);removeEventListener("pointerdown",start,true);removeEventListener("keydown",start,true);` +
    `var t=document.createElement("template");t.innerHTML=${scriptJson(preloads)};document.body.appendChild(t.content);` +
    `t.innerHTML=${scriptJson(module)};var original=t.content.firstElementChild,s=document.createElement("script");` +
    `for(var a of original.attributes)s.setAttribute(a.name,a.value);s.textContent=original.textContent;b.replaceWith(s)}` +
    `function visible(){if(document.visibilityState==="hidden")start()}` +
    `document.addEventListener("visibilitychange",visible);addEventListener("pointerdown",start,true);addEventListener("keydown",start,true);` +
    `if(document.visibilityState==="hidden")start();` +
    `else{` +
    `try{if(PerformanceObserver.supportedEntryTypes&&PerformanceObserver.supportedEntryTypes.indexOf("largest-contentful-paint")>=0){po=new PerformanceObserver(function(){if(done)return;frame=requestAnimationFrame(function(){timer=setTimeout(start,0)})});po.observe({type:"largest-contentful-paint",buffered:true})}}catch(e){po=null}` +
    `if(po)timer=setTimeout(start,3000);` +
    `else frame=requestAnimationFrame(function(){if(done||armed)return;armed=true;frame=requestAnimationFrame(function(){if(!done&&!timer)timer=setTimeout(start,0)})})` +
    `}` +
    `})();</script>`;
}

// 动画帧回调后的任务只给浏览器绘制机会，不保证已呈现；应用初始化不能依赖 FCP 观测事件，后台不等帧回调。
// 收到第一条 LCP 候选再启动，入口脚本排在首个内容绘制之后；之后更大的候选（如晚到的封面图）仍可能晚于启动；
// 访客先按下指针或键盘就立即启动，SSR 按钮不必等满上限才水合（那一下本身不重放）；
// observe() 对不支持的类型只警告不抛错，须先查 supportedEntryTypes，否则 WebKit 会一直等满上限；
// 不支持 LCP 的浏览器按原两帧路径兜底，3 秒仍未上报也照常启动。
// 启动时一起恢复预加载，再原位替换入口脚本，既不形成 import 瀑布，也不留下水合时多余的节点。
export function deferModulePreloads(html: string): string {
  const head = html.indexOf("</head>");
  const bodyEnd = html.lastIndexOf("</body>");
  if (head < 0 || bodyEnd < head) return html;
  const preloads = (html.slice(0, head).match(MODULE_PRELOAD) ?? []).map(lowPriority).join("");
  const before = html.slice(0, head).replace(MODULE_PRELOAD, "");
  let deferred = false;
  const between = html.slice(head, bodyEnd).replace(SCRIPT, (module, attributes: string) => {
    if (deferred) return module;
    const bootstrap = deferredScript(module, attributes, preloads);
    if (!bootstrap) return module;
    deferred = true;
    return bootstrap;
  });
  return before + between + (deferred ? "" : preloads) + html.slice(bodyEnd);
}
