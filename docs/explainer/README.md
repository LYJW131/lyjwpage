---
kind: runbook
---

# lyjw.me 运行原理 · 讲解动画

线上地址 `https://lyjw.me/explainer`，发布的是 `v2/` 这一版：分镜与旁白见 [SCRIPT.md](SCRIPT.md)，写章约定、预览和自检见 [v2/CONVENTIONS.md](v2/CONVENTIONS.md)，改片子与整片逐帧验收的流程见 [lyjwpage-explainer](../../.claude/skills/lyjwpage-explainer/SKILL.md)，怎么发布见下文「站点版」。

这个目录根上是上一版的页面源，保留作参考和 Artifact 发布，不进站点构建；其中 `clawd.js` 和 `fonts/` 也被 v2 引用，随站点版发布。上一版里 Claude Code 的像素螃蟹 Clawd 讲解这个站点怎么运转：10 章、130 小节（100 BPM，约 5 分 13 秒）。画面、配乐和音效都在浏览器里按同一条时间轴确定地生成，同一个时刻总是同一帧。除「站点版」一节外，本文说的都是上一版。

| 文件 | 内容 |
| --- | --- |
| `index.html` | 本地入口：舞台、样式、播放器（开场选配乐，底栏可切换） |
| `engine.js` | 舞台、镜头、Clawd、气泡、音效时间表、逐帧画面分析（自动配音效） |
| `kit.js` | 卡片、连线、数据包、印章、主页模型等画面组件 |
| `scenes-0.js` … `scenes-4.js` | 各章场景，时间一律写章节内时间 |
| `music.js` | 四种配乐（芯片 / 钢琴 / Lo-fi / 拨弦）与画面音效的合成；`PLAN` 每章小节数必须和场景的 `chapter()` 一致 |
| `film.js` | 启动、导出接口（`window.__seek` 等）、页面内播放器 |
| `render/` | 渲染、混音、抽帧自检、播放器测试 |

四个配乐 `music-{chip,piano,lofi,pluck}.mp3`（128 kbps）随页面入库；发布到 Artifact 用的 `artifact.html` 是生成物，不进仓库。

## 站点版

`scripts/build-explainer.mjs` 在 `pnpm build` 时从 `v2/` 生成 `public/explainer/`（不进仓库）：入口 `index.html` 保持原名，`workers/site/src/index.ts` 把 `/explainer` 落到构建期生成的 explainer 静态资产；页面载入的脚本（`v2/index.html` 的 `LOAD` 表）和内联样式引用的字体按内容哈希改名放进 `a/`，缓存一年；配乐不进仓库，见下一段。页面和 `v2/film.js` 经注入的 `window.__assets` 查哈希名；本地预览和写章工具没有这张表，用原名。`LOAD` 表里还没写的章不发布，站点上是占位画面。

站点版的整片配乐放在 R2，不进仓库。对象键是乐谱输入（`scripts/explainer-score.mjs#scoreInputs`：Clawd 动作时序、章节表、合成器、各章乐谱和渲染脚本）的 sha256，页面经 `/img/<键>.mp3` 取它（同图片一样由 `site` Worker 经 R2 绑定直出、`lyjw131.com` 经 ESA 回源）。改了这些文件的提交进了 main，`.github/workflows/explainer-score.yml` 渲染并上传（分支不自动渲染，预览上现合成；可对内部开发分支手动运行）；同一个键已经在 R2 就跳过，对象传上后不覆盖，main 连续推送时只留最后一次在渲。上传用仓库 secret `R2_SCORE_ACCESS_KEY_ID` / `R2_SCORE_SECRET_ACCESS_KEY`，渲染那一步不带凭据。

Chrome 默认版本由工作流的 `SCORE_CHROME_VERSION` 固定，手动运行时可用 `chrome-version` 覆盖。`v2/tools/score-mp3.mjs` 按可用 CPU 自动选择并行数（可用 `SCORE_WORKERS` 指定），输出浏览器准备、合成、PCM 转换、传输与 MP3 编码耗时，工作流另用 ffprobe 核对音频时长、采样率和声道。

CLI 并行渲染将 pad / bass 按 Web Audio 音色参数预渲染并复用，在 PCM 中统一混入 duck 控制；其余音符按 `v2/score.js#RENDER_BATCH_SECONDS` 滚动调度并回收结束的节点，并行段按采样帧对齐，以 `RENDER_WARMUP_SECONDS` 预热混响和反馈延迟。拼接后统一做响度处理与限幅；CLI 只载入配乐输入，PCM 直接送入 ffmpeg，不经过 Base64 或临时 WAV。无效采样会使任务失败。浏览器缺配乐时的 `Score.render()` 保留原生 pad / bass 节点，按窗口调度 duck，不建立整片声部缓存；默认峰值归一直接处理输出缓冲区，避免整片限幅临时数组。

构建不查对象在不在：还没传上或取不到时，播放器在浏览器里现合成；时长和章节表对不上时同样弃用。乐谱改了键就跟着变，不会再放旧配乐。看某次构建该取哪个键：

```bash
node scripts/explainer-score.mjs    # 打印当前乐谱对应的 <键>.mp3
```

本地试听整片要渲一份，要本机 Chrome、PATH 上带 libmp3lame 的 ffmpeg，以及装好的 `render/` 依赖（见「渲染配乐与音效」）；写出的 `docs/explainer/v2/score.mp3` 只给本地预览用，已在 `.gitignore`：

```bash
node docs/explainer/v2/tools/score-mp3.mjs
# 核对并行与串行音频；默认覆盖多个切点，--full 核对整片
node docs/explainer/v2/tools/score-check.mjs --full
# 核对浏览器后备合成；不分配整片声部缓存
node docs/explainer/v2/tools/score-check.mjs --browser-fallback --full
```

本地 `pnpm dev` 要看 `/explainer`，先跑一次 `node scripts/build-explainer.mjs`；没配 `R2_PUBLIC_BASE_URL` 时 `/img` 不通，配乐走现合成。

## 中英两版

默认中文，`?lang=en` 或页面上的「English / 中文」切换（记在 localStorage，切换时带着进度重新载入）。英文不改场景代码：`i18n.js` 在英文模式下把写进 `innerHTML` / `textContent` 的文字片段按 `i18n-en.js` 的对照表替换；气泡在 `say()` 里整句替换，打字时长和说话音效仍按中文原句算，所以两种语言共用同一条配乐。逐字出现的文字（终端提问、LLM 对照行、歌词占位、片尾）在源头用 `window.__tr()` 整句换。歌名、剧名、人名这类数据源内容照原样。

改了中文文字后，英文对照表要跟上：

```bash
node $R/harvest.mjs "$H" /tmp/missing.json      # 英文模式下没查到译文的中文片段（应为 0）
node $R/bubblehit.mjs "$H"                      # 英文气泡比中文多压到的元素
node $R/overflow.mjs "$H" en                    # 卡片里溢出边框的文字（缩小的主页模型本来就裁切，可忽略）
```

## 预览

```bash
node docs/explainer/render/serve.mjs docs/explainer 4817
```

打开 `http://localhost:4817`（`.claude/launch.json` 里的 `explainer-preview` 是同一条命令）。这个静态服务支持 Range 请求，拖进度、换配乐后跳回原位置都依赖它。

## 渲染配乐与音效

渲染工具用本机 Chrome（`playwright-core`，`channel: "chrome"`）。这个目录不在 pnpm 工作区里，单独装依赖：

```bash
pnpm --dir docs/explainer/render install --ignore-workspace
```

脚本打开页面用的是 `file://` 绝对路径，下面在仓库根目录执行：

```bash
H="$PWD/docs/explainer/index.html"; R=docs/explainer/render; O=/tmp/explainer
# 配乐：四种风格可以并行，芯片最慢（约 10 分钟）
node $R/render.mjs audio "$H" $O/music-chip.wav chip
# 音效轨：chip 配芯片版，soft 配其余三版；同时输出让位曲线 duck.wav 和 cues.json
node $R/render.mjs sfx "$H" $O/sfx-chip chip
node $R/render.mjs sfx "$H" $O/sfx-soft soft
# 混音：配乐先校到 −17 LUFS，再叠音效、限幅，输出 wav + mp3（音效增益：chip 1.0、piano 0.8、lofi 0.9、pluck 0.9）
node $R/mixstyle.mjs $O/music-chip.wav $O/sfx-chip 1.0 $O/mix-chip
cp $O/mix-chip.mp3 docs/explainer/music-chip.mp3
```

配乐只取决于 `music.js`（乐谱和 `PLAN`）；音效取决于画面。只改画面、不改章节小节数时，先用 `cuesjson.mjs` 导出音效时间表和上一版比对，没变就不用重渲音效。

## 自检

```bash
node $R/frames.mjs "$H" /tmp/frames 58.6 62.4 263.8   # 按时间抽帧；末尾打印排版自检（气泡停留、出界、重叠）
node $R/sheet.mjs /tmp/frames /tmp/sheet.png 2 960     # 拼联系表（目录用绝对路径）
node $R/crabcheck.mjs "$H"                             # 章节交界处 Clawd 的位置是否连续
node $R/cuesjson.mjs "$H" /tmp/cues.json               # 导出音效时间表
node $R/switchtest2.mjs "$H"                           # 换配乐的边界情况
node $R/edge2.mjs http://localhost:4817/              # 加载失败回退、放完重播、触屏底栏、封面（要先起预览）
node $R/phone2.mjs "$H" /tmp/phone.png                 # 375 / 390 手机布局
```

无头 Chrome 的虚拟声卡每次开播后约 0.6 秒不走时；CPU 被占满时偶尔还会自己暂停播放。这两种现象都不是播放器的问题。

## 发布

`render/build-artifact.py` 从 `index.html` 生成 `artifact.html`，去掉 doctype/html/head/body 外壳。发布时把它和这个目录下的脚本、字体、四个 mp3 一起发布为 claude.ai 上的私有 Artifact。站点上的 `/explainer`（v2）随 main 自动部署，见「站点版」。

```bash
python3 $R/build-artifact.py docs/explainer/index.html docs/explainer/artifact.html
```

## 口径

- 事实以仓库代码为准，核对基线与出处见 [FACTS.md](FACTS.md)。站点架构有变动时，先重核它。
- 延迟只说「8 月实测 0.32–0.49 s」。
- 窗口标题的隐私判断只说到这一层：Jev 参与判断，拿不准的交给 lyjw，只有放行的标题才进信封。不写判据；Jev 面板上的概率条是示意值。
- 站点自检相关画面不出现 Cloudflare 账号 ID、真实报错和可用率数字。
- 歌词一律用占位。
