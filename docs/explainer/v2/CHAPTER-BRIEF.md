# 讲解片 v2 · 写章任务书（模板）

> 类型：runbook

> 派单时把 `{{…}}` 换掉，删掉用不上的括号内容。一份任务书对应一位作者：一章，或相邻的两章。
> 末尾「各章要点」里挑出这位作者那一章（几章）的条目，贴进「本章要点」。

## 你要做什么

为 lyjw.me 的站点讲解动画（`/explainer` 新版 v2，全篇 2D）写第 {{NN}} 章「{{章名}}」{{（和第 MM 章「…」）}}：画面、中英文字、这一章的配乐。全程中文沟通。

用户已定、不要再讨论的：全篇 2D，没有透视和 3D；第 02 章的纸面检查单是标杆风格；Clawd 只在关键处出场；旁白排进图版里（不是字幕，也不是 Clawd 的气泡）；中英双语；配乐只有一首、浏览器里合成、节拍和画面对齐；每章小节数已锁定（SCRIPT 章节表）；不管性能。

## 在哪做

- 仓库 `/Users/liangyangjunwei/Developer/lyjwpage`，讲解片的阶段分支 `worktree-agent-ac4062c4eeafc53fa`，基线提交 `31fe736`。
- 在自己的工作树上做：`git worktree add .claude/worktrees/explainer-ch{{NN}} -b explainer/ch{{NN}} 31fe736`。已经给你分配了工作树的，先看 `git log --oneline -3` 里有没有 `31fe736`，没有就 `git switch -c explainer/ch{{NN}} 31fe736`。
- 本机 git 要带前缀：`DEVELOPER_DIR=/Library/Developer/CommandLineTools git …`（Xcode 许可没接受，不带会报错）。
- 渲染工具的依赖在主仓装好了，工作树里建软链：`ln -s /Users/liangyangjunwei/Developer/lyjwpage/docs/explainer/render/node_modules docs/explainer/render/node_modules`。

## 先读（按顺序）

1. `docs/explainer/v2/CONVENTIONS.md`：全文。这是契约，下面没重复的规矩都在里面。
2. `docs/explainer/SCRIPT.md`：开头几条、章节表、你这一章的全部内容，以及前后两章在章节表里的「交给下一章」那一格。
3. `docs/explainer/TREATMENT.md`：「调色板」「字体」「语气与禁区」「2D 画法总则」和你这一章那一节。
4. `docs/explainer/FACTS.md`：SCRIPT 在你这一章开头写的那几节。画面和旁白里的每个端点、数字、谁做什么都要在这里找得到。
5. 样板代码：纸面章读 `docs/explainer/v2/ch02.js` + `docs/explainer/v2/music/ch02.js`，暗底章读 `docs/explainer/v2/ch03.js` + `docs/explainer/v2/music/ch03.js`。`kit.js`、`engine.js`、`film.js`、`score.js` 需要时查，不改。
6. 根目录 `AGENTS.md` 的「文档与注释」：注释只写为什么、约束、坑，不写历史，不复述代码。

## 本章要点

{{从末尾「各章要点」贴过来}}

## 交付

- `docs/explainer/v2/ch{{NN}}.js`：画面。顶部 `I18N.add` 是这一章的全部文字（键 `ch{{NN}}.*`），旁白原文照 SCRIPT。
- `docs/explainer/v2/music/ch{{NN}}.js`：配乐。锚点对齐 SCRIPT 的配乐栏和画面里「落在拍上」的动作；信封主题换一件本章的乐器唱。
- 可选：SCRIPT 里你那一章的修订（旁白改字、段落时点微调；小节数不能改）；FACTS 对应那一节补的出处。
- 提交：只 `git add` 上面这些路径，中文提交信息（如 `docs(explainer): 第 {{NN}} 章{{章名}}`），签名提交。1Password 锁着时签名会挂住或报 `failed to fill whole buffer`：别加 `--no-gpgsign`，把改动留在暂存区，在汇报里说。
- 汇报（不超过 300 字）：提交 SHA；`check.mjs` 结果；中、英联系表的路径；前后两章的交接怎么做的、有没有偏离 SCRIPT；要主创做的事（该提进 `kit.js` 的局部函数、要加的音色或剧情音、FACTS 待核的事实、要相邻章配合的地方）。

## 怎么自检

在工作树根目录跑，输出放你自己的临时目录（scratchpad），不要放进仓库：

```bash
node docs/explainer/v2/tools/check.mjs {{NN}}                        # 中英都查：字太小、缺文字键、报错；必须通过
node docs/explainer/v2/tools/stills.mjs <目录> c{{NN}}:0 c{{NN}}:1.5 …  # 每个机位、每句旁白、每个配乐锚点各一帧
node docs/explainer/v2/tools/stills.mjs <目录> --lang en c{{NN}}:0 …
node docs/explainer/v2/tools/stills.mjs <目录> c{{前一章}}:{{前一章最后}} c{{NN}}:0 c{{NN}}:{{本章最后}} c{{后一章}}:0   # 交界四帧，中英都抽
node docs/explainer/v2/tools/stills.mjs <目录> --scale 0.2 c{{NN}}:…     # 挑两三帧看 375px 手机上旁白读不读得清
montage <目录>/zh_c{{NN}}_*.png -tile 4x -geometry 960x540+4+4 -background '#222' <目录>/sheet_zh.png
```

打印本章配乐事件落在哪些小节，逐个和画面落点对一遍：

```bash
cd docs/explainer/v2 && node -e '
const fs=require("fs"),vm=require("vm"),ctx={console};ctx.window=ctx;vm.createContext(ctx);
for (const f of ["plan.js","score.js","music/ch{{NN}}.js"]) vm.runInContext(fs.readFileSync(f,"utf8"),ctx);
const S=ctx.Score.build(ctx.PLAN.filter(p=>p.id==="ch{{NN}}"));
for (const [k,v] of Object.entries(S.events)) if (v.length) console.log(k.padEnd(7), v.map(t=>(t/S.BAR).toFixed(2)).join(" "));'
```

- 联系表逐张看：字够大、没有压字和出界、英文不溢出、交接连得上、颜色只用调色板。
- 相邻章还没写时，交界那几帧里对方是占位画面：只核你这一侧（首帧怎么起、尾帧怎么落，和 SCRIPT 章节表一致），接不接得上由主创合并后再核，汇报里说明。
- 不要用浏览器面板截图（面板隐藏时是空帧）。要开预览：`node docs/explainer/render/serve.mjs docs/explainer 4827`，看 `http://localhost:4827/v2/?only=ch{{前一章}},ch{{NN}},ch{{后一章}}`，用完关掉。

## 不能碰

- 别的章的文件；共用文件：`engine.js`、`kit.js`、`film.js`、`plan.js`、`i18n.js`、`index.html`、`score.js`、`tools/`。
- 不 push，不合 main，不 `git add -A`，不提交 `score.mp3`、截图和联系表。
- 不运行 mexicat/pdoom-video 的代码；不改线上旧版讲解片（`docs/explainer/*.js`、`scenes-*.js`）和 `scripts/build-explainer.mjs`。
- 不上画面的东西见 CONVENTIONS「事实」：隐私判断的判据、Sentry 的组织名和数字、密钥、歌词原文、没重测的延迟、厂商 logo；编码用量不点存储键和模块名。

## 怎么不和别的章撞

- 你只动自己的两个文件（加上 SCRIPT 里你那一章、FACTS 里你补的出处）。并行的另一位作者也一样，合并时不会撞。
- 要新的共用件：写成本章文件里的局部函数，汇报里列出来，收尾由主创提进 `kit.js`。
- 要新和弦：写在本章乐谱的 `chords` 里（名字全片唯一）。要新音色、新剧情音：先用现有的顶上，汇报里写清要什么声音、落在哪几拍。
- 交接照 SCRIPT 章节表做；需要相邻章配合的，写进汇报，由主创转达，不去改别人的文件。
- 交回前 `git rebase worktree-agent-ac4062c4eeafc53fa`（阶段分支可能已经合进了别的章）。

## 各章要点（派单时挑对应的贴进「本章要点」）

- **00 这张卡片从哪来**：开头终端那一帧要和第 09 章最后一帧完全相同（首尾循环）。主页线框按首屏真实布局的比例画（`src/lib/home-layout.ts`、`src/app/page.tsx`），卡片数按写章时的代码，不说数。总览图里「采集端」（上报器）和中枢里的「采集 Worker」是两样东西，别混。
- **01 野外观测站**：最长、事实最多（FACTS §1）。编码用量那一段只讲「Mac、云端、容器里的 Cursor 各报原始事实，站点侧合并；Pulse 上有一条 token 速率」，不点存储键和模块名；编码用量的新契约进 main 之后，先按 main 重核 FACTS §1 再写这一段。Jev 那段只说参与、拿不准交主人、放行才进信封，概率条是示意。表盘的指针数按写章时的采集任务表（`workers/collector/src/registry.ts` 的 `JOBS`）。结尾火花要从画面右边飞出去，第 02 章 0:0 从左边接。
- **04 活字印版**：开头接第 03 章的满屏纸（见 CONVENTIONS「交接」03 → 04：首帧满屏纸、`uGridA` 从 0 起、首帧后期参数和第 03 章最后一帧一样）。印版块数、带不带标签按写章时的代码现数（`src/lib/status-views.ts` 的 `STATUS_VIEWS`），旁白不说数。重印的例子是第 03 章那次在线 → 离线失效的 3 个标签；换歌不重印（换歌不失效首屏）。
- **05 电报线**：时间轴只画先后，不标毫秒（代码注释里那几个数没重测）。live 绿第一次在这里出现，只给在线人数。主角那封 listening-now 在这一章到站、卡片翻面。回填节奏、5 分钟兜底的名单按 FACTS §5 和 `src/lib/poll-schedule.ts`，编码卡不举例。
- **06 两条线路**：在听卡的封面来自 Apple 目录，不走 `/img`；图片举例用 Emby 海报或 Mac 应用图标。发版接力六站按 FACTS §6 的顺序；转调用本章乐谱的 `chords`。
- **07 节拍器**：三台的时间都出自 FACTS §7；「人数问不到就当 0」「PS5 关机停在 30 分钟档」「两轮之间至少 55 秒」都要画到。配乐真的换档（全速 → 半速 → 很慢 → 回到全速），BPM 不变。
- **08 心电图与地层**：Sentry 不出组织名、监控 ID、真实报错标题、可用率数字，令牌只说只读。「报到只证明 cron 跑完了」。Coding 的打分窗口按 `shared/pulse-coding.ts`；编码用量新契约进 main 之后先重核 FACTS §3 再写 Coding 那一层。live 绿第二次、也是最后一次出现。
- **09 一首歌的旅程**：要复用各章的画法，等其余各章都交了再做；闪回用各章自己的底。不标延迟。最后一帧和第 00 章第一帧完全相同。
- **分组与顺序**（每次最多两位作者并行）：先 04+06、05（和编码用量无关，可以马上开）；再 01、07+08（01、08 等编码用量的新契约进 main、FACTS 重核后开）；最后 00+09。
