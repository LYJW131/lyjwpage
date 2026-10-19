// <scrip<script>…</script>t> 去掉内层后又是 <script>，所以删到不再缩短。
export function stripScripts(html: string): string {
  let current = html;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  } while (current !== previous);
  return current;
}
