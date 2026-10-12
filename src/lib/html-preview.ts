export const HTML_PREVIEW_HEIGHT_KEY = "lyjwHtmlPreviewHeight";
export const HTML_PREVIEW_MIN_HEIGHT = 120;
export const HTML_PREVIEW_MAX_HEIGHT = 640;

// 模型写的页面可能被联网搜到的注入文本带偏：除内联脚本与样式外一律不准取外部资源，免得渲染即把对话内容拼进 URL 外带。
// frame-src 'none' 写在外壳里，管的是里层页面的导航：里层脚本改 location、点链接、meta refresh 都过外壳的 frame-src，被拦下；
// 被拦的导航会把预览换成浏览器的拦截页，所以里层吞掉所有链接点击；srcdoc 的基准 URL 是站点页面，连 #锚点也会解析成站点地址被拦，改为脚本滚动（不用 scrollIntoView，它会连站点页面一起滚）。
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const REPORT_HEIGHT = `(()=>{const k="${HTML_PREVIEW_HEIGHT_KEY}",d=document.documentElement,p=()=>parent.postMessage({[k]:Math.ceil(d.scrollHeight)},"*");addEventListener("load",p);new ResizeObserver(p).observe(d);new MutationObserver(p).observe(d,{childList:true,subtree:true,attributes:true,characterData:true});addEventListener("click",e=>{const a=e.target instanceof Element&&e.target.closest("a[href]");if(!a)return;e.preventDefault();const h=a.getAttribute("href");const t=h.startsWith("#")&&document.getElementById(decodeURIComponent(h.slice(1)));if(t)scrollTo({top:t.getBoundingClientRect().top+scrollY})},true)})()`;

const RELAY_HEIGHT = `(()=>{const k="${HTML_PREVIEW_HEIGHT_KEY}",f=document.querySelector("iframe");addEventListener("message",e=>{if(e.source!==f.contentWindow)return;const h=e.data&&e.data[k];if(typeof h==="number")parent.postMessage({[k]:h},"*")})})()`;

// 里层页面去掉自带的 doctype，排在 CSP meta 与测高脚本之后：模型写的 <html>、<head> 由解析器并进已开的元素，CSP 只能被它收紧。
export function htmlPreviewDocument(source: string): string {
  const page = `<!doctype html><meta charset="utf-8">${CSP_META}<style>html{scrollbar-width:none}html::-webkit-scrollbar{display:none}</style><script>${REPORT_HEIGHT}</script>${source.replace(/^\s*<!doctype[^>]*>/i, "")}`;
  return `<!doctype html><html><head><meta charset="utf-8">${CSP_META}<style>html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe sandbox="allow-scripts" srcdoc="${escapeAttribute(page)}"></iframe><script>${RELAY_HEIGHT}</script></body></html>`;
}

export function previewHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(HTML_PREVIEW_MAX_HEIGHT, Math.max(HTML_PREVIEW_MIN_HEIGHT, Math.ceil(value)));
}
