<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# API 命名

加端点、加字段之前先对一遍这四条。这些是站点、`reporters/emby-reporter`、
`reporters/iphone-telemetry-hub`、MacTelemetryHub、Home Assistant 五方共用的约定，
改一处就得五处对齐。

1. **`/api/ingest/<来源>`** —— 按**数据是谁产生的**命名，不是按上报程序命名。
   现有的五个是 `mac`、`iphone`、`homepod`、`emby`、`apple-music`。Emby 那个曾经叫
   `emby-reporter`，泄漏了实现细节：换个代理程序名字就得跟着改。
   `mac` 和 `iphone` 是**设备级**的两个遥测中心：一台设备一个入口、一个信封、
   一个 `modules` 字典。所以充电头数据走 `mac`（观测它的是那台 Mac），活动圆环
   走 `iphone`（采集它的是手表，但搬运和观测它的是那台手机）—— 别按数据里那个
   牌子另开一个 URL 家族，`apple-health` 就是这么错过一次的。
   `apple-music` 那条两个方向都走：POST 交数据，GET 取上报器干活要用的凭据，
   同一把锁。上报器要从站点拿东西时优先这么办，别为它另开一个 URL 家族。
2. **`/api/status/<主题>`** —— `X` 是列表 / 历史，`X/now` 是此刻。
   听歌是 `listening` + `listening/now`，看片是 `watching` + `watching/now`。
   一对一对地加，别给「此刻」另起一个词（从前 `listening` 的搭档叫 `music`）。
   **推送事件名跟着这套走**：`X` 和 `X-now`（URL 里的 `/` 在事件名里写成 `-`）。
   两边错位过一次 —— 事件 `listening` 指此刻、端点 `listening` 指列表。
3. **URL 段全小写，JSON 字段 camelCase。** 这不是不一致：`/api/status/vibecoding`
   和信封里的 `vibeCoding` 模块名各守各的惯例，别去统一它俩。
4. **同一个概念，跨来源必须同名同单位。** HomePod 和 Mac 喂的都是
   `LocalNowPlaying`，所以两边一律 `positionMs` / `durationMs` / `repeatOne` /
   `observedAt`（epoch 毫秒），秒转毫秒这种事在上报侧做完再发。
   R2 上那份字节的内容地址一律叫 `objectKey`；和它并排的来源侧键要自报家门
   （`imageKey`、`iconHash`），两个键挨在一起时光看 `key` 分不出是谁的。

**不留兼容路径。** 改了名就是改了，不接受旧字段、不留旧路由 —— 双份接收意味着
两条路都得一直维护，而且坏掉的那条要等很久才会被发现。改完把四方一起更新。

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
