import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkCjkFriendlyGfmStrikethrough from "remark-cjk-friendly-gfm-strikethrough/parseOnly";
import remarkGfm from "remark-gfm";
import type { Options } from "react-markdown";

// CommonMark 的定界规则下，`**问题？**比如` 这类紧贴中文的标点会让 ** 失效；两个 cjk-friendly 插件须排在 remarkGfm 之后才生效。
export const CHAT_REMARK_PLUGINS: NonNullable<Options["remarkPlugins"]> = [remarkGfm, remarkCjkFriendly, remarkCjkFriendlyGfmStrikethrough];
