// 评审 bot 的评论尾巴（Devin 的徽章、Codex 的反馈提示）与 HTML 对判分没用。
// 删一遍会在切口两侧重新拼出 <script（如 <scrip<script>t>），所以删到不再缩短。
export function clean(comment: string) {
  let text = comment.split(/\n<a href=|\n---\n\*Was this helpful|\nUseful\? React/)[0];
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^<>]+>/g, "");
  } while (text !== previous);
  return text.replace(/\n{3,}/g, "\n\n").trim().slice(0, 1200);
}
