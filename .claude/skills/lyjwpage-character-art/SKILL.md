---
name: lyjwpage-character-art
description: 改站点深色模式里的青子动态立绘，或给站点做新的动态立绘时用：加表情、闭眼格与眨眼，素材超分、去色带、精细抠图，位移场绑定图，手部分层，施法场景与秘技召唤的特效贴图，逐帧截图验收。lyjw 说「加个表情」「眨眼不对」「眉毛会跳」「头发太怪」「换一张立绘」「让 X 动起来」「复刻原作场景」「换秘技特效」时都用；lyjw 拿来 Live2D、mesh 绑定这类一键工具问能不能用时，也先看这里的弃用记录。
---

# 动态立绘

青子不是网格绑定：一张抠好的立绘，加一张权重图驱动 WebGL 位移场；表情是贴在脸上的图集格；施法场景画在立绘前后两张 2D 画布上。代码都在 `src/components/space-backdrop/`：

| 文件 | 管什么 |
| --- | --- |
| `aoko.ts` | WebGL 立绘：位移场、眨眼（`lidAt`）、表情格取样、手部分层、重打光、显形 |
| `aoko-face.ts` | 表情图集的格与调度：`FACE_BOX`、`FACES`、`IDLE`、`faceDirector` |
| `aoko-fx.ts`、`aoko-floor.ts`、`aoko-rings.ts`、`aoko-paint.ts` | 身后光环、电弧、地面法阵、手臂三环 |
| `aoko-summon.ts`、`scene.ts` | 秘技监听与逐键特效、召唤编排 |

贴图在 `public/mascots/aoko*`，特效贴图由 `scripts/aoko-fx-assets.ts` 导出。外部来源登记在 `docs/references.md`「设计系统与 UI」一节。

## lyjw 的口味

- 画风以站上这张立绘为准。解包素材库只当表情、构图的参考，不拿来换图。
- 复刻原作要精准：位置、大小在原作整帧上打网格量出来，按瞳距换算到立绘，不凭感觉摆。
- 动态「微微有就行」。新加的摆动、缩放、扭曲先给小幅度，lyjw 嫌少再加。
- 每一版都给截图或录屏。lyjw 说「回到上一版」，就整版回退再小改，不在被否的版本上修。
- 改脸、补被挡住的内容用 Codex 的图像生成（`codex exec`），lyjw 认可这条路，送图前不用再问。素材是 TYPE-MOON 的，原始图层和母图只放本机，进仓库的只有导出的 webp。

## 流程

复制到状态行，做完一项打勾；只加表情就做 3 和 6。

```
- [ ] 1 素材：超分 → 去色带 → 精细抠图
- [ ] 2 绑定图：头发 / 裙摆 / 头部三通道
- [ ] 3 表情与眨眼：Codex 改脸 → 对齐贴回 → 图集
- [ ] 4 局部分层：只拆手
- [ ] 5 场景特效：在原作整帧上量，导出贴图
- [ ] 6 验收：逐帧截图，给 lyjw 看图
```

每一步的命令、参数和踩过的坑在 [pipeline.md](pipeline.md)，按节号找。什么算做完：

1. 深色底 2 倍放大看，没有蓝边、没有色带，发丝不断成虚线。
2. 连拍 40 帧算逐像素标准差，只有头发和裙摆亮；逐帧看，发梢不打折、不勾成钩。
3. `face_patch.py patch` 打出的残差和现有各格同一量级；在真 WebGL 里逐个强制表情截脸，图集格序对得上。
4. 摆幅最大那帧放大看，手腕切口不裂、袖口不断线。
5. 和原作参考帧并排，位置、大小、层次一致；默认页面不加载特效贴图。
6. 截图、逐帧序列或录屏发给 lyjw；临时调试钩子已删。

提新做法之前先看 [dead-ends.md](dead-ends.md)：SVG 矢量化、LaMa 补头发、整体拆层、整条手臂转、mesh-avatar-studio 都试过，各有不行的原因。

## 工具

脚本在 [scripts/](scripts/)，用法看各自的 `--help`（`face-brief.md` 是模板，说明在它开头）：

- `face_patch.py`：裁脸、把 Codex 的输出对齐贴回、按 `FACES` 拼图集。坐标和格序从 `aoko-face.ts` 读，`FACES` 用到但缺图的格会报出来。
- `matte.py`：BiRefNet 粗抠，再按已知背景色反解透明度。
- `face-brief.md`：给 Codex 改脸的提示词模板。
- `capture.mjs`：无头浏览器召唤青子，用假时钟定格截图、逐帧连拍、截脸。内置浏览器面板隐藏时截图是空帧，所以截图走它。工作树里先软链主仓的 `docs/explainer/render/node_modules`，它才找得到 Playwright。

超分用仓库里的 `scripts/aoko-fx-sr.py`（Real-ESRGAN anime 6B），模型权重不在仓库。母图目录（超分抠图后的整张立绘、脸部底图 face_open、表情原件、旧脚本存档）和素材库的位置记在本机项目记忆 aoko-face-pipeline 与 mahoyo-asset-library；云端会话拿不到这些文件，要用就请 lyjw 在本机跑。

## 交付

- 有外观变化就先给 lyjw 看图，点头再合（根 `AGENTS.md`「界面设计」）。
- 提交前 `rg -n "__aoko" src` 应为空：截图用的临时钩子不进仓库。
- lyjw 要制作过程海报时照 `HUMAN.md`「7. Claude 怎么向你汇报」。
