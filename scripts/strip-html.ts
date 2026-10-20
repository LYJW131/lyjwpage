function untilStable(text: string, pattern: RegExp) {
  let previous;
  do {
    previous = text;
    text = text.replace(pattern, "");
  } while (text !== previous);
  return text;
}

// 删一遍会在切口两侧重新拼出 <!-- 或 <script（如 <!<!--x-->-->、<scrip<script>t>），所以删到不再缩短。
// <!--> 与 <!---> 是空注释；没闭合的只删 <!-- 本身：回复常在行内代码里写 <!--，吞到结尾会连后面的修复 SHA 一起删掉。
export function stripHtmlComments(text: string) {
  return untilStable(text, /<!--(?:-?>|[\s\S]*?-->)?/g);
}

export function stripHtmlTags(text: string) {
  return untilStable(text, /<[^<>]+>/g);
}
