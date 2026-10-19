// <scrip<script>…</script>t> 去掉内层后又是 <script>，所以删到不再缩短；结束标签按 HTML 规则可带空白、属性、大写。
export function stripScripts(html: string): string {
  let current = html;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, "");
  } while (current !== previous);
  return current;
}
