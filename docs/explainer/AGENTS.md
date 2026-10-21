# docs/explainer（讲解动画）

`/explainer` 页面的源和渲染工具。预览、渲染配乐、发布的命令在 `README.md`，事实出处在 `FACTS.md`，这里只写动手前要知道的约束。改片子（事实、分镜、并行写章）和整片逐帧验收的流程见 `.claude/skills/lyjwpage-explainer/SKILL.md`。

## 口径（画面与旁白）

- 事实以仓库代码为准，出处在 `FACTS.md`：动画里出现的每个端点、数字、谁做什么，都要能在它里面找到；站点架构有变动时先重核并改它，再改分镜。
- 窗口标题的隐私判断只说到这一层：先过两份应用名单（「从不读」「不用问」），其余由 TypeSafe System One 上的 Jev 判断；放行的进信封，私密的锁定，拿不准的问 lyjw。不写判据（题面、阈值、名单内容）；Jev 面板上的概率条是示意值。
- 站点自检相关画面不出现 Cloudflare 账号 ID、真实报错和可用率数字；歌词一律用占位。歌名、剧名、人名这类数据源内容照原样。
- 没有重测的数字不出（延迟尤其如此），完整的口径清单见 `README.md` 的「口径」一节。

## 须成对修改

- `v2/plan.js` 的 `PLAN`（每章小节数）⇄ 各章自己写的 `bars` ⇄ `v2/music/ch<NN>.js` 的 `harm` 长度：三处必须一致，否则配乐和画面错位；不一致时页面控制台报错，`v2/tools/check.mjs` 不过。
- 改了中文文字，同一章 `I18N.add` 里的英文要跟上：`v2/tools/check.mjs` 报缺文字键，`v2/tools/en-cjk.mjs` 列出英文模式下还画出来的中文，应只剩歌名、PR 标题这类数据。
- 上一版（根上的 `scenes-*.js`）：`music.js` 的 `PLAN` ⇄ 各章的 `chapter()`；改中文后用 `render/harvest.mjs` 查英文对照表漏掉的片段（应为 0）；只改画面时先用 `render/cuesjson.mjs` 比对音效时间表，没变就不重渲音效。
- 站点版由 `scripts/build-explainer.mjs` 在 `pnpm build` 时从 `v2/` 生成到 `public/explainer/`（不进仓库）：入口 `index.html` 保持原名，`workers/site/src/index.ts` 把 `/explainer` 落到构建期生成的 explainer 静态资产；脚本只认 `v2/index.html` 的 `LOAD` 表（保持 JSON 写法），连同内联样式里的相对 `url()` 按内容哈希改名。新增别的资源要让脚本拷得到：页面上新的相对 `src` / `href` 它会报错，脚本里取的文件要像 `v2/film.js` 取配乐那样经 `window.__assets` 查名字。根上的 `clawd.js`、`fonts/` 也被 v2 引用。
- `v2/ch08.js` 的 `SLOW` ⇄ `v2/music/ch08.js` 的 `SLOW`：画面按原来的小节写、放慢几段播，配乐与音效按同一张表换算时刻；两边不一致，音效对不上动作。
- `v2/music/ch<NN>.js` 的 `SFX` 用到的名字 ⇄ `v2/sfx/<名字>.mp3` ⇄ `v2/sfx/CREDITS.txt` 的署名：新增音效要带许可（CC0 / CC BY）和署名，缺文件时页面控制台报「音效 … 载入失败」。换了某个音效文件，同步改 `v2/score.js` 的 `SFX_LEAD` 里它的提前量（文件里最响那一下的时刻）。
- `v2/ch00.js` 里的字 ⇄ `fonts/{BarlowSemiCondensed,NotoSansSC}-{300,500}-ch00.woff2`、`v2/ch01.js` 里的字 ⇄ `fonts/{Fredoka,ZCOOLKuaiLe,ZenMaruGothic-700}-ch01.woff2`、`v2/ch02.js` 里的字 ⇄ `fonts/{NotoSansSC-700,NotoSansSC-900,BigShoulders-600,BigShoulders-900}-ch02.woff2`、闸号与三块章的数字 ⇄ `fonts/BigShouldersStencil-900-ch02.woff2`、`v2/ch03.js` 里的字 ⇄ `fonts/{NotoSerifSC-700,ZCOOLXiaoWei,Limelight}-ch03.woff2`、`v2/ch09.js` 里的字 ⇄ `fonts/{Inter,NotoSansSC}-{500,700}-ch09.woff2`、`v2/ch08.js` 里的字 ⇄ `fonts/LXGWMarkerGothic-ch08.woff2`、`v2/ch04.js` 与 `v2/ch06.js` 里的字 ⇄ `fonts/NotoSerifSC-{600,900}-ch04-06.woff2`、`v2/ch06.js` 里的字 ⇄ `fonts/MaShanZheng-ch06.woff2`、`v2/ch05.js` 里的字 ⇄ `fonts/{ZCOOLQingKeHuangYou,NotoSansSC-700,Jost-500,Jost-600,Jost-800}-ch05.woff2`、`v2/ch07.js` 里的字 ⇄ `fonts/NotoSansSC-{500,700}-ch07.woff2`、它的标题「对话」「Chat」、PUSH START、429 ⇄ `fonts/FusionPixel{12,8}px-ch07.woff2`：字体只切了这几章用到的字，加了新字要重切（`README.md`「站点版」），不然新字退回系统字体。 `v2/ch10*.js`（`ch10.js`、`ch10-cast.js`、`ch10-relay.js`、`ch10-relay2.js`、`ch10-split.js`、`ch10-bow.js`）借第 00–09 章的字体：重切上面任何一份时，把这几个文件也列进字表，第 10 章加了新字也要按它借的那几份重切。
- `v2/ch07.js` 末帧 ⇄ `v2/ch08.js` 首帧：几何（`HEAD`、`COMMITS` 抄 `Y0`、`HEAD0`、`OLD`）和大厅的画法、种子都照抄，改一边另一边跟上，用 `stills.mjs` 对交界两帧。
- `v2/ch10.js` 借的别章 `share`：`ch00` 的 `termFrame`、`termState`、`paperFrame`、`cut.post`，`ch02` 的 `whipBand`；第 01 站（`v2/ch10-relay.js#s1world`）借第 01 章的 `window.CH01`：three.js 世界 `W`（`view`、`draw`，`pose` 的 `actors` / `vaneYaw` 两个覆盖项）和模型坐标 `models.L`；分屏（`v2/ch10-split.js`）调各章自己的 `render`，各章 `bars` 与 `CELLS` 的起点要在章内。改这些导出两边一起改。
- 配乐不入库：`scripts/explainer-score.mjs#scoreInputs` 列的文件决定 R2 上的对象键，合进 main 后由 `.github/workflows/explainer-score.yml` 渲染上传（`README.md`「站点版」）。合成配乐时新读了别的文件，要加进 `scoreInputs` 和工作流的 `paths`，否则改了它键不变、线上放旧配乐。
- 成片视频也不入库：`scripts/explainer-score.mjs#videoInputs` 决定视频键（`README.md`「成片视频」），`LOAD` 表里的脚本自动算进去；画面新读了表外的文件要加进 `videoInputs`，只管弹窗和播放、不影响导出帧与 `window.__audio()` 的脚本才放进 `VIDEO_PLAYER_ONLY`。`v2/tools/video-release.mjs` 的编码档次与级别 ⇄ `v2/watch.js#TYPES` 的 codecs；视频键的格式 ⇄ `src/lib/site-policy.ts#IMAGE_OBJECT_PATH`（`scripts/explainer-score.test.mjs` 核对）。键变了的提交合进 main 后，要 lyjw 在 Mac 上重跑出片命令，弹窗里的预渲染视频才可选。

## 环境

- 本目录不在 pnpm 工作区，也不走站点的 eslint（`eslint.config.mjs` 忽略它）；渲染工具单独装依赖：`pnpm --dir docs/explainer/render install --ignore-workspace`。
- 预览：`node docs/explainer/render/serve.mjs docs/explainer 4817`（`.claude/launch.json` 的 `explainer-preview` 是同一条命令）。本地 `pnpm dev` 要看 `/explainer`，先跑一次 `node scripts/build-explainer.mjs`。
- 无头 Chrome 的虚拟声卡每次开播后约 0.6 秒不走时，CPU 被占满时还会自己暂停播放：这都不是播放器的问题。
