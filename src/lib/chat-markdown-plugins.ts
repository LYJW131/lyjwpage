import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough/parseOnly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Options } from "react-markdown";

// CommonMark 的定界规则下，`**问题？**比如` 这类紧贴中文的标点会让 ** 失效；两个 cjk-friendly 插件须排在 remarkGfm 之后才生效。
// 公式只认 $$…$$（行内或独占一行）：回复里常有「$10 / $50」这类价格，单个 $ 也算公式会把两个价格之间的字吞成公式。
export const CHAT_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [remarkGfm, remarkCjkFriendly, remarkCjkFriendlyGfmStrikethrough, [remarkMath, { singleDollarTextMath: false }]];
export const CHAT_REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [[rehypeKatex, { strict: "ignore" }]];

type HastNode = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: HastNode[] };

// 汉字、假名、谚文逐字切，其余按词（连同后面的空白）切：中文没有空格，按词切会整句一起淡入。
const STREAM_TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+\s*|\s+/gu;
// pre 里是代码与图示的 JSON，拆开会破坏排版与解析。
const STREAM_SKIP = new Set(["pre", "svg", "math"]);

// KaTeX 的排版靠嵌套 span 的定位，拆开会错位。
const isKatex = (node: HastNode) => Array.isArray(node.properties?.className) && node.properties.className.includes("katex");

function fadeTokens(node: HastNode) {
  if (!node.children || (node.tagName && STREAM_SKIP.has(node.tagName)) || isKatex(node)) return;
  node.children = node.children.flatMap((child): HastNode[] => {
    if (child.type !== "text" || !child.value) {
      fadeTokens(child);
      return [child];
    }
    return streamTokens(child.value).map((token) => /^\s+$/.test(token)
      ? { type: "text", value: token }
      : { type: "element", tagName: "span", properties: { className: ["stream-token"] }, children: [{ type: "text", value: token }] });
  });
}

export function streamTokens(text: string): string[] {
  return text.match(STREAM_TOKEN) ?? [];
}

// 参考 Streamdown 的做法：流式期间把文字拆成一个个 span，React 只给新挂载的 span 播淡入，已经在的不重播；回复结束后不挂这个插件。
export const rehypeStreamFade = () => (tree: HastNode) => fadeTokens(tree);
export const CHAT_STREAM_REHYPE_PLUGINS: NonNullable<Options["rehypePlugins"]> = [...CHAT_REHYPE_PLUGINS, rehypeStreamFade];
