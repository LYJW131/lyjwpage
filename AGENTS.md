<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 图标

要加品牌 / 产品图标时，**先去 LobeHub 的图标集找**，别自己画、也别随手扒一张位图：

- 在线浏览 <https://lobehub.com/icons>
- 取文件走包更省事：`https://unpkg.com/@lobehub/icons-static-svg@<版本>/icons/<名字>.svg`
  （903 个图标，命名规律是 `<名字>.svg` 单色、`<名字>-color.svg` 彩色、`<名字>-text.svg` 带字）

**一律优先 SVG。** 矢量在任何倍率下都清晰，体积通常还比位图小（antigravity 换成 SVG 时 72KB → 7.6KB）。
实在只有位图时才退而求其次，并且要先压到展示尺寸再入库，不要让站点在请求时现压。

两条容易踩的：

1. **`fill="currentColor"` 的图标不能用 `<img>`（含 `next/image`）加载。** SVG 经 `<img>` 是独立文档，
   `currentColor` 取不到页面的文字色，会渲染成黑的。要么挑 `-color` 那版（颜色写死在文件里），
   要么把 SVG 内联成组件——`vibecoding-card.tsx` 里的 Anthropic / OpenAI 标记就是内联的写法。
2. **静态图标一律标 `unoptimized`。** 它们已经是最终形态，过一遍图片管道只是多一次转换、多一份
   Vercel 配额，还把本可以直连 CDN 的请求绕回自己的函数。图片管道只留给「请求时才知道该多大」
   的图（当前全站只有自建歌单封面这一处）。
