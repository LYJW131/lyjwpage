# 动态立绘的六步：命令、参数与坑

目录：[1 素材](#1-素材超分去色带精细抠图) · [2 绑定图](#2-绑定图与位移场) · [3 表情与眨眼](#3-表情与眨眼) · [4 手部分层](#4-局部分层只拆手) · [5 场景特效](#5-场景特效与召唤贴图) · [6 验收](#6-验收与交付)

命令都在仓库根目录跑，先设好 `SK=.claude/skills/lyjwpage-character-art/scripts`。Python 一律 `uv run -q --with … python -I`。

## 1 素材：超分、去色带、精细抠图

lyjw 给的多是官方海报：JPEG、纯色底、压着大字。先处理干净再做别的；lyjw 两次单独提过「线条不够精细」「颜色有断层」。

```sh
# 4 倍超分后缩回 2 倍当工作尺寸
uv run -q --with torch --with spandrel --with pillow --with numpy python -I scripts/aoko-fx-sr.py <RealESRGAN_x4plus_anime_6B.pth> poster.png sr4x.png
magick sr4x.png -alpha off -filter Lanczos -resize 50% sr2x.png
# 只抹 JPEG 留下的断层：超分后线条已经干净，阈值放低不糊线
ffmpeg -loglevel error -y -i sr2x.png -vf "deband=1thr=0.012:2thr=0.012:3thr=0.012:range=24:blur=1" -pix_fmt rgb24 srdb.png
# BiRefNet 粗抠，再按已知背景色反解；--crop 取人物框
uv run -q --with numpy --with scipy --with pillow --with "rembg[cpu]" python -I $SK/matte.py srdb.png master.png --bg blue --crop x0,y0,x1,y1
```

- 粗抠用 BiRefNet（`birefnet-general`）。isnet-anime 会把背景大字和地面碎片一起抠进来。
- 阈值抠图会让发丝缝透出底色、断成虚线，所以要反解：`matte.py` 用局部背景色 B 和邻近不透明前景色 F，α = (I−B)·(F−B)/|F−B|²；越透明的像素颜色越靠 F，不然反解会放大噪点，发丝出黄边。
- 母图坐标就是代码坐标：`aoko.ts` 的 `SRC_W` × `SRC_H` 是 1 倍框，母图是它的 2 倍。重抠时裁切框严格按 2 倍对齐，绑定图和各处坐标就不用重做。
- `--bg blue` 只认偏蓝的纯色底；别的底色先在背景上取样，写成 `--bg <hex>:<容差>`。
- 海报字压住的发梢要补画（Codex 或手修），补出来的那截没有线稿，lyjw 看得出。补哪几处，先在原图上标出来给 lyjw 看，点头再补。
- 裁切框一次定死：它就是代码坐标系，之后再改，绑定图、表情框和着色器里的坐标都得重量。
- 站点贴图按 2 倍屏上画布的像素宽导出（由 `aoko.ts` 的 `MAX_WIDTH`、`PAD` 算出），`cwebp -q 94 -sharp_yuv -alpha_q 100 -exact`：质量再低，色带会被压缩带回来。

## 2 绑定图与位移场

`public/mascots/aoko-rig.png` 是半分辨率的权重图：R 头发、G 裙摆、B 头部。`aoko.ts` 的片元着色器按权重对每个像素反向取样：头发是沿发丝传播的正弦波，裙摆按 x 错开相位，头部绕颈部转，呼吸是腰线以上整体抬升加胸口横向微扩。

权重怎么画：

1. 颜色只给候选：棕发按色相、饱和度、明度圈，但袖子、黑丝、靴子也会被当成头发。所以在 64 px 网格图上量出手、手臂、躯干的多边形，从候选里扣掉。
2. 头发区先闭运算连成片，再外扩约 45 px，最后做 σ≈28 的高斯模糊；离发根越远权重越大，靠近身体的地方柔和压低。
3. 裙摆取腰线以下最大的一块红色，补洞、外扩后 σ≈14 模糊，越往下摆越大。头部是一个椭圆，σ≈22 模糊。

权重边缘只模糊几个像素、再叠高频谐波时，切口正好落在发丝之间和发梢上，发梢会打折、勾成钩（lyjw：「头发太奇怪了」）。大范围模糊、去掉谐波后，整缕一起弯。

验收：连拍 40 帧算逐像素标准差，只有飘发和裙摆亮，腿和靴子不动；再逐帧看发梢。旧的绑定图脚本存档在本机母图目录。

换角色时，`aoko.ts` 的片元着色器里还有按青子量出的坐标，直接写成数字：颈部转轴、呼吸的胸口和腰线起伏带、胸口中线、两眼的椭圆和眼线高度。常量里也有：`aoko.ts` 的 `ARM_BOX`、`PALM`、`CHIN_Y`，`aoko-fx.ts` 的 `ORB`，`aoko-face.ts` 的 `FACE_BOX`，手臂三环的 `aoko-rings.ts#FOREARM`。在新母图上逐个重量；把这些点和区域画在立绘上出一张图，一眼就能核对。

## 3 表情与眨眼

`aoko-face.ts` 的图集是 `FACE_COLS` × `FACE_ROWS` 格，每格盖在原图 `FACE_BOX` 那块正方形上，alpha 是只盖眉眼和嘴的羽化遮罩。`FACES` 里每个表情两个格号：`tile` 是睁眼时叠的格（-1 是原图），`shut` 是眨眼时眼皮合向的格（-1 是不眨）。

加一个表情：

1. **底图**。所有格都以同一张脸部底图 face_open 为底，母图目录里有；丢了就重裁：
   `uv run -q --with numpy --with scipy --with pillow python -I $SK/face_patch.py crop <2 倍母图> face_open.png --face-ts src/components/space-backdrop/aoko-face.ts`
2. **挑表情**。站上整张脸约 88 CSS px、眼睛约 9 px。读得出的是嘴的开合、闭眼、单眼眨、眉角、笑眼；平静和微皱眉这种差别读不出，不值得占一格。参考图从素材库的立绘里找（位置见本机记忆 mahoyo-asset-library）：文件名 `AOK_<A|L|M|N|S>_<服装>_<姿势>_<表情>`，N 是脸部特写、做参考最清楚；服装 04 是站上这身红裙长靴；同一姿势的各表情身体逐像素一致；小写的 `aok_*` 是加了模糊描边的演出版，不用。
3. **Codex 改脸**。照 `$SK/face-brief.md` 写提示词，每个表情一个工作目录：
   ```sh
   codex features list | grep image_generation   # 要是 true
   cd <工作目录> && timeout 1500 codex exec --skip-git-repo-check -s workspace-write -C . "$(cat brief.md)" -i face_open.png -i expression_ref.png > codex_run.log 2>&1
   ```
   提示词放在 `-i` 前面：`-i` 吞后面所有参数，放在后面时 Codex 会停下来等标准输入。单张约 4 到 6 分钟，可以几张并行，放后台跑。
   模板里「只生成一次、生成后立刻保存」那句别删：没有它时 Codex 有时出了一张又接着重画，拖到超时，工作目录里什么都没有。真超时了，先去 `~/.codex/generated_images/` 找它已经出的那张。
4. **配套闭眼格**。要眨眼的表情另出一张闭眼图，以这个表情的 Codex 原图为底，不以喊叫脸为底，否则眨眼时眉毛会跳。各表情的 Codex 原图（1024）和参考图放在母图目录的 face-codex/<名字>/，新生成的也放进去，以后补闭眼格要用。闭眼写成「略向下弯的睫毛线」，明说不要 ^ ^ 笑眼、不要挤眼。不眨的表情（已经闭着、单眼眨、眼形和闭眼图差太多）`shut` 写 -1。
   为什么眉毛会跳：眼皮快闭到底时，着色器（`aoko.ts` 片元着色器里的 `full`）把整张闭眼格连眉毛一起盖上去，所以闭眼格的眉毛必须和睁眼那格一致。`FACES` 里 `shut` 借用别的表情闭眼格的，都要核对。修法有两条：以这个表情的 Codex 原图为底出闭眼格，最稳；两张脸眼形相近时，也可以从现有闭眼格裁出只含眼睛的一块放进空格，不用跑 Codex：眉毛区透明，盖上去时眉毛留着当前表情的。
5. **对齐贴回**。`patch` 在 512 空间里穷举缩放 0.98–1.02、平移 ±8 px，只在五官以外算误差，再按遮罩边缘那一圈把 Codex 的整体偏色拉回来：
   `uv run -q --with numpy --with scipy --with pillow python -I $SK/face_patch.py patch face_open.png shy=<输出>.png shy_shut=<闭眼输出>.png:eyes --tiles <母图目录>/face-tiles`
   换角色先在 512 空间里量出两眼（含眉）和嘴的椭圆，用 `--eyes`、`--mouth` 传，默认值是青子的。`:eyes` 只取眉眼，嘴留给当前表情。现有各格的残差在 2.4 到 4.2；明显更大就重出，提示词里再强调取景、大小逐像素不动。打开 tiles 目录里的 check 对照图看接缝。不要整张贴：Codex 会把全图轻微重画一遍，只有遮罩内可用。
6. **拼图集**。先在 `FACES` 里加这一格，再拼：
   `uv run -q --with numpy --with scipy --with pillow python -I $SK/face_patch.py atlas <母图目录>/face-tiles public/mascots/aoko-faces.webp --face-ts src/components/space-backdrop/aoko-face.ts --extra 0=angry_shut,7=relaxed_shut,14=shy_shut`
   格名取 `FACES` 的键；只当闭眼格用的格（只出现在 `shut`、不出现在 `tile` 的格号）用 `--extra` 起名，以 `FACES` 为准，漏了脚本会报出来。格序是 `FACES` 与图集之间的契约，改一边就重拼。
7. **排进调度**。`IDLE` 里给权重，不然平时轮不到它；要跟着施法节拍或鼠标出现就改 `beat` 或 `NOTICE`。

眨眼时序在 `aoko.ts#lidAt`，取自 Live2D 的 `CubismEyeBlink`（见 `docs/references.md`）。眼皮不是交叉淡化（会有重影），而是上下眼线朝当前表情那一格闭眼图的闭眼线会合。交叉淡化表情时不眨。

**在真 WebGL 里验**，不看离线合成。临时加两个钩子，截完就删：

```ts
// aoko-face.ts，faceDirector() 里 face(t) 的第一行
const pin = (globalThis as unknown as { __aokoFace?: FaceName }).__aokoFace;
if (pin) return { from: FACES[pin].tile, to: FACES[pin].tile, mix: 1, shut: FACES[pin].shut };
// aoko.ts，frame() 里算 closed 的那行
const closed = (globalThis as unknown as { __aokoLid?: number }).__aokoLid ?? lidAt(t - blinkAt);
```

然后 `node $SK/capture.mjs --url <dev 地址> --out <目录> --summon --clip face --face shy,calm --lid 0,0.5,1`。

## 4 局部分层：只拆手

伸出的手、光球和握腕的右手单独一层（`ARM`，覆盖 `ARM_BOX`）；`FILL` 是同一块里 Codex 补出的手背后内容，只在手移开后露出的地方用。整条手臂绕肩转试过，不行（见 [dead-ends.md](dead-ends.md)）。

逐帧放大才找得到的坑：

| 症状 | 根因 | 修法 |
| --- | --- | --- |
| 补全区边缘有蓝、紫点 | 半透明像素按 (I−(1−α)B)/α 反解，α 小时放大噪点 | 补全区不反解，直接用 Codex 的颜色 |
| 光球下袖口一道虚线 | 抠图把深蓝带判成半透明，颜色还被估成浅灰 | 遮罩内部补成不透明，颜色取叠深色底后的样子 |
| 指尖有深色月牙残影 | 手层柔边只换掉一半原图 | 原图透明度 ≥ 0.5 就整格换成补全，勾线全部划进手层 |
| 手腕切口裂缝 | 切口半透明边下面已换成补全的胸口 | 只在摆幅大于约 0.03 的地方用补全，切口保持原图 |
| 袖口下沿断线 | 手层下沿带着发丝，和底图发丝错开 | 摆幅从指尖朝袖口、手腕两头衰减到 0 |

补全前在原图上把要去掉的部分涂成洋红，告诉 Codex 补出后面的头发、高领、肩带和前襟。

## 5 场景特效与召唤贴图

- **量**：在原作整帧参考图上打 100 px 网格，量瞳距和各元素的圆心、半径，按「站上瞳距 ÷ 原作瞳距」换算（`aoko-fx.ts` 的 `SHOT_K`）。同一帧再出一张 `magick -edge` 黑白边缘图，看清光环、符文带和手臂环的轮廓。
- **找素材**：先翻 Jev 编目的分类拼图（位置见本机记忆 mahoyo-asset-library），格下有文件名。编目没有的，对小图跑 `magick` 统计（alpha 均值、压到黑底后的蓝减红），挑出透明、偏蓝青、够大的，再 `magick montage` 拼对照表，派 Haiku 子代理逐格描述。带 `_aa_bb` 后缀的多是同一张的缩放、模糊变体。
- **导出**：改 `scripts/aoko-fx-assets.ts` 的 `CIRCLES`、`BOLTS`、`CUES` 表再重跑；`CUES` 要和 `aoko-summon.ts` 的同名表一起改。HD 比 2 倍屏显示尺寸还小的才标 `sr` 超分；发光线稿超分明显好于直接放大，SVG 描边会把光晕糊成一团。webp 的透明通道质量用 50：到 80 以上 libwebp 近乎按无损存，体积翻倍，肉眼看不出差别。
- **加载**：默认页面一张特效贴图都不加载，按下秘技第一个键才预取。

lyjw 改过的地方，再动这些元素时照着来：

- 手臂三环是沿前臂排开的竖向窄椭圆，大小照原作不一样大，靠手腕的半圈被袖子和手挡住。
- 环附近只要一点点扭曲：「波动不是这样加的，有点点扭曲就行」，不画同心水波圈。
- 身后光环的呼吸缩放要轻：「速度和幅度都调低，微微有就行」。
- 地面法阵按一行设备像素一条带画、条带不重叠；重叠时半透明砖地被画两遍，2 倍屏上出横纹。
- 显形时人物显出来的部分直接不透明，始终挡住身后的法阵；显形和召唤飞行同时开始，不等飞到位。
- 秘技按过 ↑↑ 之后，后面的方向键不再滚动页面。

## 6 验收与交付

`capture.mjs` 的全部参数看 `--help`。常用几种：

```sh
# 召唤后第 0、6 秒各截一张立绘
node $SK/capture.mjs --url http://localhost:3211/ --out shots --summon --at 0,6
# 眨眼逐帧：60 fps 连拍 40 帧，再合成视频给 lyjw
node $SK/capture.mjs --url http://localhost:3211/ --out blink --summon --frames 40 --step 16.7 --from 3 --clip face
# -framerate 要和 --step 对上（16.7 ms 一帧就是 60）才是原速；想慢放再调低
ffmpeg -framerate 60 -i blink/f%03d.png -pix_fmt yuv420p blink.mp4
# 375 px WebKit：不挂立绘，按秘技也不报错
node $SK/capture.mjs --url http://localhost:3211/ --out narrow --engine webkit --width 375 --height 812 --summon --clip viewport --at 2
```

- 本地站点用 `pnpm dev`；3211 被别的工作树占着时设 `DEV_SITE_PORT` 换端口。
- 至少看三样：1440 和 1920 宽的 2 倍屏、375 px WebKit、开「减少动态效果」（`--reduced-motion`，立绘直接是静止画面）。
- 回退照现有写法守住，新角色也一样：只在深色模式挂（`space-backdrop.tsx`）；左侧留白窄于 `scene.ts` 的 `AOKO_MIN_GUTTER` 不挂；减少动态效果只画一帧、不开动画循环；WebGL 或着色器失败时换一张 2D 画布画静态原图（`aoko.ts` 里 `rigRenderer` 返回空的那段）。
- 新增或重导的贴图在 PR 里写上 `public/mascots/` 的体积增减；比同类大一截就先降尺寸或质量。
- 接缝、发梢、手腕这些地方放大看；能拼成对照图的（改前改后、各格并排）拼起来一起发。
- 交付前删掉临时钩子（`rg -n "__aoko" src` 为空），PR 上的验证照 `lyjwpage-verify`。
