import { scriptJson } from "@/lib/inline-script";

// HTMLRewriter 给的属性值是未解码的原文（引号已去），名字已转小写；重新拼标签时只需转义双引号。
function markup(tagName: string, attributes: string[][]): string {
  let tag = `<${tagName}`;
  for (const [name, value] of attributes) tag += ` ${name}="${value.replaceAll('"', "&quot;")}"`;
  return tag;
}

// 站点同时载入 DOM 类型，全局 Element 的 attributes 被并成 NamedNodeMap；运行时是 HTMLRewriter 的 [名, 值] 迭代器。
function attributesOf(element: { attributes: unknown }): string[][] {
  return [...element.attributes as Iterable<string[]>];
}

function bootstrap(module: string, preloads: string): string {
  return `(function(){` +
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
    `})();`;
}

// 动画帧回调后的任务只给浏览器绘制机会，不保证已呈现；应用初始化不能依赖 FCP 观测事件，后台不等帧回调。
// 收到第一条 LCP 候选再启动，入口脚本排在首个内容绘制之后；之后更大的候选（如晚到的封面图）仍可能晚于启动；
// 访客先按下指针或键盘就立即启动，SSR 按钮不必等满上限才水合（那一下本身不重放）；
// observe() 对不支持的类型只警告不抛错，须先查 supportedEntryTypes，否则 WebKit 会一直等满上限；
// 不支持 LCP 的浏览器按原两帧路径兜底，3 秒仍未上报也照常启动。
// 启动时一起恢复预加载，再原位替换入口脚本，既不形成 import 瀑布，也不留下水合时多余的节点。
export function deferModulePreloads(response: Response): Response {
  let preloads = "";
  let deferred = false;
  let placed = false;
  let source: string | null = null;
  return new HTMLRewriter()
    .on('head link[rel="modulepreload"]', {
      element(link) {
        const attributes = attributesOf(link);
        if (!link.hasAttribute("fetchpriority")) attributes.push(["fetchpriority", "low"]);
        preloads += `${markup("link", attributes)}/>`;
        link.remove();
      },
    })
    .on('body script[type="module" i][async]:not([src])', {
      element(script) {
        if (deferred) return;
        deferred = true;
        const module = `${markup("script", attributesOf(script))}>`;
        script.removeAttribute("type");
        source = "";
        script.onEndTag((end) => {
          end.before(`${bootstrap(`${module}${source}</script>`, preloads)}</script>`, { html: true });
          end.remove();
          source = null;
        });
      },
      text(chunk) {
        if (source === null) return;
        source += chunk.text;
        chunk.remove();
      },
    })
    .on("body", {
      element(body) {
        body.onEndTag((end) => {
          placed = true;
          if (!deferred) end.before(preloads, { html: true });
        });
      },
    })
    .onDocument({
      end(end) {
        if (!placed && !deferred) end.append(preloads, { html: true });
      },
    })
    .transform(response);
}
