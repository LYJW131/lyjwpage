# docs/explainer（讲解动画）

`/explainer` 页面的源和渲染工具。预览、渲染配乐、发布的命令在 `README.md`，事实出处在 `FACTS.md`，这里只写动手前要知道的约束。改片子（事实、分镜、并行写章）和整片逐帧验收的流程见 `.claude/skills/lyjwpage-explainer/SKILL.md`。

## 口径（画面与旁白）

- 事实以仓库代码为准，出处在 `FACTS.md`：动画里出现的每个端点、数字、谁做什么，都要能在它里面找到；站点架构有变动时先重核并改它，再改分镜。
- 窗口标题的隐私判断只说到这一层：Jev 参与判断，拿不准的交给 lyjw，只有放行的标题才进信封。不写判据；Jev 面板上的概率条是示意值。
- 站点自检相关画面不出现 Cloudflare 账号 ID、真实报错和可用率数字；歌词一律用占位。歌名、剧名、人名这类数据源内容照原样。
- 没有重测的数字不出（延迟尤其如此），完整的口径清单见 `README.md` 的「口径」一节。

## 须成对修改

- `v2/plan.js` 的 `PLAN`（每章小节数）⇄ 各章自己写的 `bars` ⇄ `v2/music/ch<NN>.js` 的 `harm` 长度：三处必须一致，否则配乐和画面错位；不一致时页面控制台报错，`v2/tools/check.mjs` 不过。
- 改了中文文字，同一章 `I18N.add` 里的英文要跟上：`v2/tools/check.mjs` 报缺文字键，`v2/tools/en-cjk.mjs` 列出英文模式下还画出来的中文，应只剩歌名、PR 标题这类数据。
- 上一版（根上的 `scenes-*.js`）：`music.js` 的 `PLAN` ⇄ 各章的 `chapter()`；改中文后用 `render/harvest.mjs` 查英文对照表漏掉的片段（应为 0）；只改画面时先用 `render/cuesjson.mjs` 比对音效时间表，没变就不重渲音效。
- 站点版由 `scripts/build-explainer.mjs` 在 `pnpm build` 时从 `v2/` 生成到 `public/explainer/`（不进仓库）：入口 `index.html` 保持原名，`workers/site/src/index.ts` 把 `/explainer` 落到构建期生成的 explainer 静态资产；脚本只认 `v2/index.html` 的 `LOAD` 表（保持 JSON 写法），连同内联样式里的相对 `url()` 按内容哈希改名。新增别的资源要让脚本拷得到：页面上新的相对 `src` / `href` 它会报错，脚本里取的文件要像 `v2/film.js` 取配乐那样经 `window.__assets` 查名字。根上的 `clawd.js`、`fonts/` 也被 v2 引用。
- `v2/ch08.js` 的 `SLOW` ⇄ `v2/music/ch08.js` 的 `SLOW`：画面按原来的小节写、放慢几段播，配乐与音效按同一张表换算时刻；两边不一致，音效对不上动作。
- `v2/music/ch08.js` 的 `SFX` 用到的名字 ⇄ `v2/sfx/<名字>.mp3` ⇄ `v2/sfx/CREDITS.txt` 的署名：新增音效要带许可（CC0 / CC BY）和署名，缺文件时页面控制台报「音效 … 载入失败」。换了某个音效文件，同步改 `LEAD` 里它的提前量（文件里最响那一下的时刻）。
- `v2/ch08.js` 里的字 ⇄ `fonts/LXGWMarkerGothic-ch08.woff2`：字体只切了这一章用到的字，加了新字要重切（`README.md`「站点版」），不然新字退回系统字体。
- 配乐不入库：`scripts/explainer-score.mjs#scoreInputs` 列的文件决定 R2 上的对象键，合进 main 后由 `.github/workflows/explainer-score.yml` 渲染上传（`README.md`「站点版」）。合成配乐时新读了别的文件，要加进 `scoreInputs` 和工作流的 `paths`，否则改了它键不变、线上放旧配乐。

## 环境

- 本目录不在 pnpm 工作区，也不走站点的 eslint（`eslint.config.mjs` 忽略它）；渲染工具单独装依赖：`pnpm --dir docs/explainer/render install --ignore-workspace`。
- 预览：`node docs/explainer/render/serve.mjs docs/explainer 4817`（`.claude/launch.json` 的 `explainer-preview` 是同一条命令）。本地 `pnpm dev` 要看 `/explainer`，先跑一次 `node scripts/build-explainer.mjs`。
- 无头 Chrome 的虚拟声卡每次开播后约 0.6 秒不走时，CPU 被占满时还会自己暂停播放：这都不是播放器的问题。
