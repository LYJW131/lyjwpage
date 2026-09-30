# docs/explainer（讲解动画）

`/explainer` 页面的源和渲染工具。预览、渲染配乐、发布的命令在 `README.md`，事实出处在 `FACTS.md`，这里只写动手前要知道的约束。

## 口径（画面与旁白）

- 事实以仓库代码为准，出处在 `FACTS.md`：动画里出现的每个端点、数字、谁做什么，都要能在它里面找到；站点架构有变动时先重核并改它，再改分镜。
- 窗口标题的隐私判断只说到这一层：Jev 参与判断，拿不准的交给站长，只有放行的标题才进信封。不写判据；Jev 面板上的概率条是示意值。
- Sentry 相关画面不出现组织名、监控 ID、真实报错和可用率数字；歌词一律用占位。歌名、剧名、人名这类数据源内容照原样。
- 没有重测的数字不出（延迟尤其如此），完整的口径清单见 `README.md` 的「口径」一节。

## 须成对修改

- `music.js` 的 `PLAN`（每章小节数）⇄ 场景里各章的 `chapter()`：两边必须一致，否则配乐和画面错位。
- 改了中文文案，`i18n-en.js` 的英文对照表要跟上：用 `render/harvest.mjs` 查英文模式下没查到译文的片段，应为 0。
- 只改画面、不改章节小节数时，先用 `render/cuesjson.mjs` 导出音效时间表和上一版比对，没变就不用重渲音效。
- 站点版由 `scripts/build-explainer.mjs` 在 `pnpm build` 时从 `v2/` 生成到 `public/explainer/`（不进仓库）：入口 `index.html` 保持原名，`next.config.ts` 把 `/explainer` rewrite 到它；脚本只认 `v2/index.html` 的 `LOAD` 表（保持 JSON 写法），连同内联样式里的相对 `url()` 和 `v2/score.mp3` 按内容哈希改名。新增别的资源要让脚本拷得到：页面上新的相对 `src` / `href` 它会报错，脚本里取的文件要像 `v2/film.js` 取 `v2/score.mp3` 那样经 `window.__assets` 查名字。根上的 `clawd.js`、`fonts/` 也被 v2 引用。
- `v2/score.mp3` 随仓库提交：改了 `v2/plan.js` 或任何乐谱都要重渲并提交它（`README.md`「站点版」）。构建只查它在不在，时长对不上时线上退回现合成。

## 环境

- 本目录不在 pnpm 工作区，也不走站点的 eslint（`eslint.config.mjs` 忽略它）；渲染工具单独装依赖：`pnpm --dir docs/explainer/render install --ignore-workspace`。
- 预览：`node docs/explainer/render/serve.mjs docs/explainer 4817`（`.claude/launch.json` 的 `explainer-preview` 是同一条命令）。本地 `pnpm dev` 要看 `/explainer`，先跑一次 `node scripts/build-explainer.mjs`。
- 无头 Chrome 的虚拟声卡每次开播后约 0.6 秒不走时，CPU 被占满时还会自己暂停播放：这都不是播放器的问题。
