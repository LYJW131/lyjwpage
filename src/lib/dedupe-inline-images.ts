const ENQUEUE_SCRIPT = /<script>(window\.__reactRouterContext\.streamController\.enqueue\(.*?\);?)<\/script>/gs;
const INLINE_IMG = /<img\b[^>]*?\ssrc="(data:[^"]+)"/g;
const DATA_URI = /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g;

// 首屏的 base64 占位图同时出现在 <img src> 和 loader 数据里，压缩后约占整页五分之一。
// loader 数据只在 <img> 之后的脚本里取用，所以里面的副本换成「按序号读回已解析的 <img>」：
// 序号与客户端 querySelectorAll('img[src^="data:"]') 同序，base64 不含引号与反斜杠，可直接拼进 JS 字符串字面量。
export function dedupeInlineImages(html: string): string {
  return html.replace(ENQUEUE_SCRIPT, (script, body: string, offset: number) => {
    const index = new Map<string, number>();
    let count = 0;
    for (const [, src] of html.slice(0, offset).matchAll(INLINE_IMG)) {
      if (!index.has(src)) index.set(src, count);
      count++;
    }
    let replaced = false;
    const rewritten = body.replace(DATA_URI, (uri) => {
      const at = index.get(uri);
      if (at === undefined) return uri;
      replaced = true;
      return `"+D(${at})+"`;
    });
    if (!replaced) return script;
    return `<script>(function(D){${rewritten}})(function(i){var e=document.querySelectorAll('img[src^="data:"]')[i];return e?e.getAttribute("src"):""});</script>`;
  });
}
