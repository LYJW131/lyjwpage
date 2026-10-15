const MODULE_PRELOAD = /<link rel="modulepreload"[^>]*>/g;

// React 把 <Scripts /> 渲染的 modulepreload 提升进 <head>，几百 KB 的 JS 就和 HTML、样式表以 High 优先级同时下载，慢网下首帧要等它们。挪到 </body> 前：解析器读完正文才发现它们，HTML 和样式表先占带宽，仍是一批并行请求，不退化成按 import 逐层发现的瀑布。
export function deferModulePreloads(html: string): string {
  const head = html.indexOf("</head>");
  const bodyEnd = html.lastIndexOf("</body>");
  if (head < 0 || bodyEnd < head) return html;
  const preloads = html.slice(0, head).match(MODULE_PRELOAD);
  if (!preloads) return html;
  const before = html.slice(0, head).replace(MODULE_PRELOAD, "");
  const between = html.slice(head, bodyEnd);
  return before + between + preloads.join("") + html.slice(bodyEnd);
}
