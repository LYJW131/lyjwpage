// <scrip<script>…</script>t> 去掉内层后又是 <script>，所以删到不再缩短；结束标签按 HTML 规则可带空白、属性、大写。
export function stripScripts(html: string): string {
  return stripUntilStable(html, /<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi);
}

export function stripUntilStable(text: string, pattern: RegExp): string {
  let previous: string;
  do {
    previous = text;
    text = text.replace(pattern, "");
  } while (text !== previous);
  return text;
}
