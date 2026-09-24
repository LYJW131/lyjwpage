# lyjw.me 运行原理 · 讲解动画

线上地址 `https://lyjw.me/explainer`。Claude Code 的像素螃蟹 Clawd 讲解这个站点怎么运转：10 章、130 小节（100 BPM，约 5 分 13 秒）。画面、配乐和音效都在浏览器里按同一条时间轴确定地生成，同一个时刻总是同一帧。分镜与旁白见 [SCRIPT.md](SCRIPT.md)。

页面本身在 `public/explainer/`，由 Next 当静态文件发出（`next.config.ts` 把 `/explainer` rewrite 到它的 `index.html`）；这里放分镜稿、说明和渲染工具。

| 文件（`public/explainer/`） | 内容 |
| --- | --- |
| `index.html` | 本地入口：舞台、样式、播放器（开场选配乐，底栏可切换） |
| `engine.js` | 舞台、镜头、Clawd、气泡、音效时间表、逐帧画面分析（自动配音效） |
| `kit.js` | 卡片、连线、数据包、印章、主页模型等画面组件 |
| `scenes-0.js` … `scenes-4.js` | 各章场景，时间一律写章节内时间 |
| `music.js` | 四种配乐（芯片 / 钢琴 / Lo-fi / 拨弦）与画面音效的合成；`PLAN` 每章小节数必须和场景的 `chapter()` 一致 |
| `film.js` | 启动、导出接口（`window.__seek` 等）、页面内播放器 |
| `render/` | 渲染、混音、抽帧自检、播放器测试 |

四个配乐 `music-{chip,piano,lofi,pluck}.mp3`（128 kbps）随页面入库；发布到 Artifact 用的 `artifact.html` 是生成物，不进仓库。

## 预览

```bash
node docs/explainer/render/serve.mjs public 4817
```

打开 `http://localhost:4817/explainer/`（`.claude/launch.json` 里的 `explainer-preview` 是同一条命令）。这个静态服务支持 Range 请求，拖进度、换配乐后跳回原位置都依赖它。

## 渲染配乐与音效

渲染工具用本机 Chrome（`playwright-core`，`channel: "chrome"`）。这个目录不在 pnpm 工作区里，单独装依赖：

```bash
pnpm --dir docs/explainer/render install --ignore-workspace
```

脚本打开页面用的是 `file://` 绝对路径，下面在仓库根目录执行：

```bash
H="$PWD/public/explainer/index.html"; R=docs/explainer/render; O=/tmp/explainer
# 配乐：四种风格可以并行，芯片最慢（约 10 分钟）
node $R/render.mjs audio "$H" $O/music-chip.wav chip
# 音效轨：chip 配芯片版，soft 配其余三版；同时输出让位曲线 duck.wav 和 cues.json
node $R/render.mjs sfx "$H" $O/sfx-chip chip
node $R/render.mjs sfx "$H" $O/sfx-soft soft
# 混音：配乐先校到 −17 LUFS，再叠音效、限幅，输出 wav + mp3（音效增益：chip 1.0、piano 0.8、lofi 0.9、pluck 0.9）
node $R/mixstyle.mjs $O/music-chip.wav $O/sfx-chip 1.0 $O/mix-chip
cp $O/mix-chip.mp3 public/explainer/music-chip.mp3
```

配乐只取决于 `music.js`（乐谱和 `PLAN`）；音效取决于画面。只改画面、不改章节小节数时，先用 `cuesjson.mjs` 导出音效时间表和上一版比对，没变就不用重渲音效。

## 自检

```bash
node $R/frames.mjs "$H" /tmp/frames 58.6 62.4 263.8   # 按时间抽帧；末尾打印排版自检（气泡停留、出界、重叠）
node $R/sheet.mjs /tmp/frames /tmp/sheet.png 2 960     # 拼联系表（目录用绝对路径）
node $R/crabcheck.mjs "$H"                             # 章节交界处 Clawd 的位置是否连续
node $R/cuesjson.mjs "$H" /tmp/cues.json               # 导出音效时间表
node $R/switchtest2.mjs "$H"                           # 换配乐的边界情况
node $R/edge2.mjs http://localhost:4817/explainer/              # 加载失败回退、放完重播、触屏底栏、封面（要先起预览）
node $R/phone2.mjs "$H" /tmp/phone.png                 # 375 / 390 手机布局
```

无头 Chrome 的虚拟声卡每次开播后约 0.6 秒不走时；CPU 被占满时偶尔还会自己暂停播放。这两种现象都不是播放器的问题。

## 发布

`render/build-artifact.py` 从 `index.html` 生成 `artifact.html`，去掉 doctype/html/head/body 外壳。发布时把它和 `public/explainer/` 下的脚本、字体、四个 mp3 一起发布为 claude.ai 上的私有 Artifact。站点上的 `/explainer` 随 main 自动部署。

```bash
python3 $R/build-artifact.py public/explainer/index.html docs/explainer/artifact.html
```

## 口径

- 事实以仓库代码为准，2026-09-25 按 `bf6c14b` 核过。站点架构有变动时，先对照之后的提交重核。
- 延迟只说「8 月实测 0.32–0.49 s」。
- 窗口标题的隐私判断只说到这一层：Jev 参与判断，拿不准的交给站长，只有放行的标题才进信封。不写判据；Jev 面板上的概率条是示意值。
- Sentry 相关画面不出现组织名、监控 ID、真实报错和可用率数字。
- 歌词一律用占位。
