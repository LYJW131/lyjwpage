---
name: lyjwpage-explainer
description: 改 /explainer 讲解动画时用：补最近的新功能、加章删章、改画面旁白与配乐、派作者并行写章，以及整片逐帧验收（渲帧、拼图、并行派 Haiku 看图、像素比对兜底）和出带配乐的录像。lyjw 说「改讲解动画」「重做动画」「把 X 加进动画」「逐帧检查」「出个录像」时用。
---

# 改讲解动画

源在 `docs/explainer/v2/`，站点版由 `scripts/build-explainer.mjs` 在构建时生成。动手前读 `docs/explainer/AGENTS.md`（口径、须成对修改）；章节契约在 `docs/explainer/v2/CONVENTIONS.md`，派写章作者的简报模板是 `docs/explainer/v2/CHAPTER-BRIEF.md`，配乐与发布在 `docs/explainer/README.md`「站点版」。

工具都在 `docs/explainer/v2/tools/`，命令行工具都能 `--help` 看用法，配乐的 `score-*.mjs` 除外（见 `docs/explainer/README.md`「站点版」）。浏览器由 `docs/explainer/v2/tools/browser.mjs` 选：Mac 上用本机 Chrome，云端用容器里预装的 Playwright Chromium（`/opt/pw-browsers/chromium`，软件渲染），别的机器用环境变量 `CHROME_PATH` 指定。先装渲染依赖 `pnpm --dir docs/explainer/render install --ignore-workspace`（工作树里软链主仓那份）；Python 工具要 Pillow，`flicker.py` 另要 numpy。

整片重做这种要跑好几个小时的活，开一个进度 Artifact（各章状态、验收轮次），随进展更新：lyjw 要过。

## 流程

复制到状态行，逐项打勾：

```
- [ ] 1. 事实进 FACTS.md
- [ ] 2. 分镜与小节数定稿
- [ ] 3. 并行写章
- [ ] 4. 合拢：交界、共用件、中英文
- [ ] 5. 逐帧验收，直到一轮没有要改的
- [ ] 6. 录像、PR、lyjw 点头
- [ ] 7. 合并后核对配乐与生产
```

### 1. 事实

「把最近的更新加进去」先从 `git log` 和合并的 PR 找出上次改片以来的变化，要上画面的每个端点、数字、谁做什么都写进 `docs/explainer/FACTS.md`，带出处（`路径#符号`、PR 号）。事实多时派子代理按代码逐条核对。

做完：SCRIPT 里出现的每条事实都能在 FACTS 找到出处。

### 2. 分镜

章节表和每小节画面、中英旁白在 `docs/explainer/SCRIPT.md`；每章小节数以 `docs/explainer/v2/plan.js` 的 `PLAN` 为准，各章自己写的 `bars` 和 `music/ch<NN>.js` 的 `harm` 长度要和它相等，不等时页面控制台报错、`check.mjs` 不过。改了小节数或乐谱，配乐的对象键跟着变，合进 main 后由工作流重渲。

做完：SCRIPT 章节表、`PLAN`、各章 `bars` 三处一致。

### 3. 写章

- 一位作者一章（或相邻两章），简报照 CHAPTER-BRIEF 填。作者用 Opus、effort 用 xhigh：lyjw 定的强度。
- 互不依赖的章同时派（后台）。云端作者在同一个工作树里写，各只写自己那章的 `ch<NN>.js` 与 `music/ch<NN>.js`，不提交、不切分支、不用 `git stash`；要动共用文件（`kit.js`、`engine.js`、`i18n.js` 等）写进汇报，由主线程改。Mac 上各开工作树，见 CHAPTER-BRIEF「在哪做」。
- 复用各章画法的回顾章放最后。
- 看图交给 Haiku：作者不看图（CHAPTER-BRIEF「怎么自检」），交回联系表路径。主线程每份联系表派一个 Haiku（`model: "haiku"`、`effort: "high"`、后台），提示词：第一句禁止调用 `mcp__hearthbot__` 工具；读 [frame-qa.md](frame-qa.md) 的问题类型和报告格式；说明这是按文件名排的静帧，相邻两格不连续，不报 `glitch`；列出要看的图。主线程只读报告文字，把要改的条目用 SendMessage 转给作者，改完再派 Haiku 只看改过的那几张。

做完：每位作者交回 `check.mjs` 通过的结果、含交界帧的抽帧和汇报，Haiku 看过联系表、清单都处理过。

### 4. 合拢

- 主线程按汇报改共用件、统一提交，逐对核交界：上一章最后一帧接本章第一帧（`stills.mjs`，中英各一组），交界帧派 Haiku 看，提示词同第 3 步。
- `node docs/explainer/v2/tools/check.mjs` 退出码 0：不带章号查全部已写的章，带 `02` 或 `ch02` 只查那几章，中英都查。
- `node docs/explainer/v2/tools/en-cjk.mjs <输出.json>`：缺文字为 0；列出的中文逐条判断，只该剩歌名、PR 标题这类数据。也能带章号。
- 这两条不带章号时整片扫一遍要几分钟：合拢时跑一次，之后只在改了共用件（`kit.js`、`engine.js`、`score.js` 等）时重跑；只改了某章就带那章的章号。

做完：上面两条命令都过，交界逐对看过。

### 5. 逐帧验收

中文版逐帧看，英文版每 4 帧看 1 帧（画面和中文版同一套，只有字不同，每秒 6 帧够查排版）。下面 `$F` 是这一轮的帧目录，每轮一个新的（如 scratchpad 里的 `frames/r1`），上一轮的留着做比对；`$Q` 放拼图批次，各轮共用。每一轮：

1. 渲帧，中文按 CPU 核数分段并行：
   ```bash
   for i in 1 2 3 4; do node docs/explainer/v2/tools/frames.mjs $F/zh --part $i/4 & done
   node docs/explainer/v2/tools/frames.mjs $F/en --lang en --every 4 &
   wait
   ```
2. 拼图并写好派单，中英各一次：
   ```bash
   python3 docs/explainer/v2/tools/sheets.py $F/zh $Q --tag r1-
   python3 docs/explainer/v2/tools/sheets.py $F/en $Q --tag r1-
   ```
   默认每张 2 帧、每批 60 张，批目录名带轮次和语种（`$Q/r1-zh-b<首帧号>`），已经存在就停下不写。复查轮换个 tag，只挑变了的帧，加 `--changed-vs <上一轮帧目录>/zh`（英文版对应 `/en`）；这一轮修过什么写成 JSON 文件，用 `--focus <文件>` 写进派单让 Haiku 重点看，格式见 `--help`。
3. 每个批目录派一个 Haiku，提示词是该目录 `<批目录>/prompt.md` 的全文（它让 Haiku 先读本目录的 [frame-qa.md](frame-qa.md)），全部批次在一条消息里同时派出：
   ```
   Agent(description: "Haiku 逐帧验收 <批目录名>", subagent_type: "general-purpose",
         model: "haiku", effort: "high", run_in_background: true, prompt: <prompt.md 全文>)
   ```
   靠完成通知收结果，不轮询；30 分钟没回来的批次算失败、重派。`<批目录>/report.json` 里 `sheets_reviewed` 小于 `sheets_total` 的也重派。
4. 机器兜底，和 Haiku 同时跑：
   - `python3 docs/explainer/v2/tools/flicker.py $F/zh <输出.tsv>`：只闪一帧的细小毛病，Haiku 基本看不出来。
   - `node docs/explainer/v2/tools/textlog.mjs <记录.jsonl>`（英文版加 `--lang en`），再 `python3 docs/explainer/v2/tools/textcheck.py <记录.jsonl>`：叠字、出画、单帧跳变。
5. 判定：Haiku 和两个比对工具的输出都是线索，误报不少，要看图核实，看图的也是 Haiku。把这一轮的线索（帧号、类型、描述）分批写成清单，每批派一个 Haiku 复核：逐条打开那一帧，回「属实 / 误报」和一句依据。主线程只读复核结果，记进 scratchpad 里的台账，列为「批、帧、Haiku 说的、复核、判定、依据」，判定只用「已改、设计如此、误报、不改」四种。只有两个 Haiku 说法相反、又关系到改不改时，主线程才自己打开那一帧。
6. 修完先重跑改过那几章的 `check.mjs` 和 `en-cjk.mjs`（带章号），再回到第 1 步：修出框时给字加的限宽（`maxW`）会把字等比缩小，常缩到字号下限以下。

做完：最近一轮的台账里没有「已改」，比对工具的线索都判过。

### 6. 交付

- 录像：`docs/explainer/v2/tools/video.sh $F/zh <输出.mp4> <配乐.mp3>`（配乐从哪取见 `--help`），放进 `/mnt/project-files/<主题>/` 给 lyjw 看。
- PR：回执由 Verify Action 签（见 lyjwpage-verify「PR 上的验证」），PR 描述的验证清单写明在分支预览上测每个章节标签（章数以 `docs/explainer/v2/plan.js` 的 `PLAN` 为准）、`?t=` 停住、播放走时、375 宽、配乐请求和控制台。画面变了算 UI 改动，lyjw 看过录像或预览、点头再合。

### 7. 合并后

- 改了 `scripts/explainer-score.mjs#scoreInputs` 里的文件，核对 `.github/workflows/explainer-score.yml` 在 main 上这次运行成功（对象已在就跳过上传）。
- 画面或音效变了（`node scripts/explainer-score.mjs --video` 打印的键和 main 上次不同），配乐工作流跑完后提醒 lyjw 在 Mac 上跑 `node docs/explainer/v2/tools/video-release.mjs` 出片上传（`docs/explainer/README.md`「成片视频」）；传上之前弹窗里的预渲染视频是灰的。
- 生产核对照 lyjwpage-verify「合并后部署与生产核对」：`deploy-check.ts --expect site`，两个域名的 `/explainer` 都测。

## 坑

- 帧只在同一台机器、同一个浏览器上能逐字节比：复查轮的新旧两份要在同一处渲，Mac 和云端渲的不混比。改动造成的差异可能只有几个色阶，所以 `--changed-vs` 按字节比、不设像素阈值；同机重渲个别帧偶尔也差几个色阶，代价只是多挑出零星几帧。
- 页面载入后渲的第一帧会和之后再渲同一时刻差几个色阶，`frames.mjs` 头一帧先空渲一次；自己写渲染脚本时照做。
- 每张拼 2 帧时每格仍是原尺寸，持续多帧的问题抓得和 1 帧一张一样多，花费约六成；拼 4 帧以上格子被缩小，细小问题开始漏。实测见 `docs/explainer/frame-qa-calibration.md`。
- `flicker.py` 在镜头连续运动的段落会标出大量正常帧，按能量从高往低看。
- 派单提示词第一句禁止调用 `mcp__hearthbot__` 工具：子代理拿得到线程工具，不写明会去改线程的状态行或发消息。
- 帧、拼图、`docs/explainer/v2/score.mp3`、录像都不进仓库，放 scratchpad 或 `/mnt/project-files/`。
