import { EXACT_IMAGE_HOSTS, SUFFIX_IMAGE_HOSTS } from "@/lib/image-proxy";
import type { GOD_CHAT_HTML_THEME_VARS } from "@shared/god-chat";

export const HTML_VISUAL_HEIGHT_KEY = "lyjwHtmlVisualHeight";
export const HTML_VISUAL_OPEN_KEY = "lyjwHtmlVisualOpen";
export const HTML_VISUAL_MIN_HEIGHT = 24;
export const HTML_VISUAL_MAX_HEIGHT = 800;

export const HTML_VISUAL_THEME_VARS = {
  "--fg": "--foreground",
  "--muted": "--muted-foreground",
  "--line": "--line",
  "--surface": "--surface",
  "--accent": "--signal-blue",
  "--red": "--signal-red",
  "--orange": "--signal-orange",
  "--yellow": "--signal-yellow",
  "--green": "--signal-green",
  "--blue": "--signal-blue",
  "--violet": "--signal-violet",
} as const satisfies Record<(typeof GOD_CHAT_HTML_THEME_VARS)[number], string>;

export type HtmlVisualTheme = {
  scheme: "light" | "dark";
  vars: Record<string, string>;
  font: string;
  fontSize: string;
  fontFaces: string;
};

// 模型写的页面可能被联网搜到的注入文本带偏：只准内联脚本与样式，外部资源只放行站点图片、字体和工具数据里出现的图片主机，
// 都不是攻击者能读日志的地方，免得渲染即把对话内容拼进 URL 外带。
// frame-src 'none' 写在外壳里，管的是里层页面的导航：里层脚本改 location、点链接、meta refresh 都过外壳的 frame-src，被拦下。
function csp(origin: string): string {
  const images = [`${origin}/img/`, ...EXACT_IMAGE_HOSTS, ...SUFFIX_IMAGE_HOSTS.map((host) => `*.${host}`)].map((host) => (host.startsWith("http") ? host : `https://${host}`));
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    `img-src data: blob: ${images.join(" ")}`,
    `font-src data: ${origin}/site-assets/`,
    "media-src data: blob:",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 被拦的导航会把图示换成浏览器的拦截页，所以里层吞掉所有链接点击：http(s) 链接交给站点在点击当下开新标签页，
// #锚点改为脚本滚动（srcdoc 的基准 URL 是站点页面，#锚点也会解析成站点地址；不用 scrollIntoView，它会连站点页面一起滚）。
const INNER_SCRIPT = `(()=>{const d=document.documentElement;let l;const p=()=>{const h=Math.ceil(Math.max(d.getBoundingClientRect().height,document.body?document.body.scrollHeight:0));if(h!==l){l=h;parent.postMessage({"${HTML_VISUAL_HEIGHT_KEY}":h},"*")}};addEventListener("load",p);new ResizeObserver(p).observe(d);new MutationObserver(p).observe(d,{childList:true,subtree:true,attributes:true,characterData:true});addEventListener("click",e=>{const a=e.target instanceof Element&&e.target.closest("a[href]");if(!a)return;e.preventDefault();const h=a.getAttribute("href");if(h.startsWith("#")){const t=document.getElementById(decodeURIComponent(h.slice(1)));if(t)scrollTo({top:t.getBoundingClientRect().top+scrollY});return}parent.postMessage({"${HTML_VISUAL_OPEN_KEY}":new URL(h,document.baseURI).href},"*")},true)})()`;

const RELAY_SCRIPT = `(()=>{const f=document.querySelector("iframe");addEventListener("message",e=>{if(e.source===f.contentWindow)parent.postMessage(e.data,"*")})})()`;

// 里层页面去掉自带的 doctype，排在 CSP meta、主题样式与注入脚本之后：模型写的 <html>、<head> 由解析器并进已开的元素，CSP 只能被它收紧。
// color-scheme 必须与站点一致，iframe 才保持透明，图示直接落在对话的底色上。
// body 设 position:relative，没有定位祖先的绝对定位元素才会计入 body.scrollHeight，上报的高度不会把它们裁掉。
export function htmlVisualDocument(source: string, theme: HtmlVisualTheme, origin: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp(origin)}">`;
  const vars = Object.entries(theme.vars).map(([name, value]) => `${name}:${value}`).join(";");
  const style = `${theme.fontFaces}:root{color-scheme:${theme.scheme};${vars}}html{scrollbar-width:none}html::-webkit-scrollbar{display:none}body{position:relative;margin:0;background:transparent;color:var(--fg);font-family:${theme.font};font-size:${theme.fontSize};line-height:1.6}`;
  const page = `<!doctype html><meta charset="utf-8">${meta}<style>${style}</style><script>${INNER_SCRIPT}</script>${source.replace(/^\s*<!doctype[^>]*>/i, "")}`;
  return `<!doctype html><html><head><meta charset="utf-8">${meta}<style>:root{color-scheme:${theme.scheme}}html,body{margin:0;height:100%;overflow:hidden;background:transparent}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><iframe sandbox="allow-scripts" srcdoc="${escapeAttribute(page)}"></iframe><script>${RELAY_SCRIPT}</script></body></html>`;
}

export function visualHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(HTML_VISUAL_MAX_HEIGHT, Math.max(HTML_VISUAL_MIN_HEIGHT, Math.ceil(value)));
}

export function visualLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
