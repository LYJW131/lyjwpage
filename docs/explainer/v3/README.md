# lyjw.me 运行原理 · v3「拆开来看」

> 类型：decision

v3 是对 `/explainer` 的另一种做法，目前只有第 01 章样章，用来定调。它不沿用 v2 的「工程图册」路线（每章一个比喻、纸面与暗底交替、Clawd 出镜），改成下面四条：

- **布景只有一个：站点首页本身。** 卡片框按 `docs/explainer/v2/ch04.js#P` 的实测比例画，每章从首页上一张真实的卡出发，把它「拆开」，顺着一根线走回数据的源头，再走回这张卡。没有比喻层，站上长什么样，片里就画什么样。
- **一镜到底。** 镜头只有平移和缩放，没有硬切；去程快速拉远回溯，回程跟着一颗橙色数据珠慢放一遍。
- **机器说英文，旁白说中文。** 画面里的标注一律是代码里的真名（`StateHub`、`listening-now`、`CORE.commitIngest`），等宽字；只有旁白是中文大字，排在左下，用一层渐黑的底托住。
- **只有一种颜色。** 底色、面、线、字全部取自站点暗色主题的 token（`src/app/globals.css`），橙色（`--claude`）只给正在流动的数据和它经过的站点；没有发光的字，没有纸纹。

事实口径和 v2 相同，出处是 [../FACTS.md](../FACTS.md)。第 01 章跟的是 Mac 上一次换歌：Apple Music → Mac Telemetry Hub → ingress → StateCore / StateHub → LivePushRoom → 浏览器的 SWR → 卡片翻面。

## 文件

| 文件 | 内容 |
|---|---|
| `index.html` | 入口与播放器外壳；Geist 从 `../fonts/` 取，中文字体从 Google Fonts 取 Noto Sans SC（本机有 PingFang SC 时优先用它） |
| `engine.js` | Canvas2D 画布、站点调色板、字体、缓动、镜头与文字工具 |
| `ch01.js` | 第 01 章：时间表 `AT`、镜头 `CAM1` / `CAM2`、数据珠 `BEAD`、首页与站点的画法、旁白 |
| `film.js` | 时间轴与播放器：空格播放，左右键 ±1 s，`,` `.` 逐帧；`?t=` 定位，`?export` 去掉底栏 |
| `tools/stills.mjs` | 按时刻截 1920×1080 的 png |
| `tools/frames.mjs` | 逐帧截图，配 ffmpeg 拼 mp4 |
| `tools/artifact.mjs` | 内联成单文件、字体改走 Google Fonts，供发布到 claude.ai Artifact |

节拍按 96 BPM 记（一小节 2.5 s），`bars` 是章长，配乐还没做。

## 预览与渲染

```bash
node docs/explainer/render/serve.mjs docs/explainer 4817     # 打开 http://localhost:4817/v3/
pnpm --dir docs/explainer/render install --ignore-workspace  # 截图工具的依赖（playwright-core）
node docs/explainer/v3/tools/stills.mjs "$PWD/docs/explainer/v3/index.html" /tmp/v3 3 12.4 31
node docs/explainer/v3/tools/frames.mjs "$PWD/docs/explainer/v3/index.html" /tmp/v3f 30
ffmpeg -framerate 30 -i /tmp/v3f/f%05d.jpg -c:v libx264 -pix_fmt yuv420p /tmp/v3.mp4
```

截图工具用的是预装的 Chromium（路径写在脚本里），本机跑时改成自己的 Chrome。
