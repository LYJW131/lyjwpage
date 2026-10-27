# 动态立绘的六步：命令、参数与坑

目录：[1 素材](#1-素材超分去色带精细抠图) · [2 绑定图](#2-绑定图与位移场) · [3 表情与眨眼](#3-表情与眨眼) · [4 手部分层](#4-局部分层只拆手) · [5 场景特效](#5-场景特效与召唤贴图) · [6 验收](#6-验收与交付)

命令都在仓库根目录跑，先设好 `SK=.claude/skills/lyjwpage-character-art/scripts`。Python 一律 `uv run -q --with … python -I`。

## 1 素材：超分、去色带、精细抠图

lyjw 给的多是官方海报：JPEG、纯色底、压着大字。先处理干净再做别的；lyjw 两次单独提过「线条不够精细」「颜色有断层」。

先定尺寸：1 倍代码框（`aoko-figure.ts` 的 `SRC_W` × `SRC_H`）里人物高约 1900 px，和青子同量级；母图是它的 2 倍。超分固定放大 4 倍，再按 `sr.py --scale` 缩到母图尺寸，倍数由海报大小反推（例子见 `sr.py --help`）。`sr.py` 的 `--crop` 就是代码坐标系的框，一次定死：之后再改，绑定图、表情框和着色器里的坐标都得重量。重抠青子时，裁切框照原来的对齐，这些就都不用重做。

```sh
# 裁人物框、超分、缩到母图尺寸
uv run -q --with torch --with spandrel --with pillow --with numpy python -I $SK/sr.py <权重.pth> poster.jpg sr.png --scale 2 --crop x0,y0,x1,y1
# 只抹 JPEG 留下的断层：超分后线条已经干净，阈值放低不糊线
ffmpeg -loglevel error -y -i sr.png -vf "deband=1thr=0.012:2thr=0.012:3thr=0.012:range=24:blur=1" -pix_fmt rgb24 srdb.png
# BiRefNet 粗抠，单独存下：要和原图并排查漏，matte.py 也要用
uv run -q --with "rembg[cpu]" --with pillow python -I -c 'import sys; from PIL import Image; from rembg import new_session, remove; remove(Image.open(sys.argv[1]).convert("RGB"), session=new_session("birefnet-general")).save(sys.argv[2])' srdb.png rough.png
# 按已知背景色反解；--detext、--keep 见下
uv run -q --with numpy --with scipy --with pillow python -I $SK/matte.py srdb.png master.png --rough rough.png --bg blue --detext <底色> --keep keep.png
```

超分权重是 Real-ESRGAN 发布页的 [RealESRGAN_x4plus_anime_6B.pth](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth)，sha256 `f872d837d3c90ed2e05227bed711af5671a6fd1c9f7d7e91c911a61f155e99da`；本机放在青子母图目录的 models/。

- 粗抠用 BiRefNet（`birefnet-general`）。isnet-anime 会把背景大字和地面碎片一起抠进来。
- 阈值抠图会让发丝缝透出底色、断成虚线，所以要反解：`matte.py` 用局部背景色 B 和邻近不透明前景色 F，α = (I−B)·(F−B)/|F−B|²；越透明的像素颜色越靠 F，不然反解会放大噪点，发丝出黄边。
- `--bg blue` 按偏蓝的程度判背景，发丝缝里底色和黑发混出的深蓝也算背景。别的纯色底写成 `--bg <hex>:<容差>`，在超分、去色带之后的图上取样，不在海报原图上取。
- **同色部件会被抠穿**：人物身上和底色同色系的部件（有珠的蓝宝石钥匙、蓝灰虹膜）会被反解成半透明。`--bg blue` 照用，部件另做保留遮罩，用 `--keep` 按原色贴回：`keepmask.py` 圈出描边围住的同色面，眼睛这类没被描边围住的画椭圆并进去。改判据保不住，试过的两条见 [dead-ends.md](dead-ends.md)。
- **白字会把底色估白**：贴着人物的白字会把局部底色估白，字和轮廓之间的缝就反解成一串半透明底色点。`--detext <底色>` 先把人物外的白字涂掉再抠。粗抠把字算进人物的那一小块（有珠钥匙下面那截「遠」）它管不到，要按框单独涂掉。
- **BiRefNet 会漏小物件**：毛球、挂绳、饰品在粗抠里是空心的，`matte.py` 跟着抠成半透明空心环。把粗抠 α 和原图并排看一遍；漏了的用 `keepmask.py --chroma --hole-max 150` 补进保留遮罩。只填小洞，不然被发丝围住的底色三角也会被填上。
- **海报字先分前后**：放大看交界处，是字断开还是人物断开。在人物身后的字就是背景，抠图自然去掉；只有压在人物前面的才补画，补的可能是发梢，也可能是鞋跟、裙摆。补哪几处，先在原图上标出来给 lyjw 看，点头再补：补出来的那截没有线稿，lyjw 看得出。
- **补画放在抠图之前**，分三步：
  1. 在超分图上把要补的字涂成洋红，裁 512 送 Codex。
  2. `paste_patch.py` 按「洋红区并上被挡部件的整块」贴回。只贴洋红区，会和露在外面的半截对不上。
  3. 补完重跑 BiRefNet 再抠。不然新补的部分在粗抠里没算进人物，会被封顶成半透明。
- 验收：叠深色底放大 2 倍，看发丝、轮廓和小物件。再量两样：实心区里 α<250 的像素只剩真透光的发丝缝；保留遮罩外 α>40 又偏蓝（b−max(r,g)>45）的像素接近 0。剩下的贴着轮廓，压掉的办法见有珠的抠图全链。
- 站点贴图按 2 倍屏上画布的像素宽导出（由 `aoko.ts` 的 `MAX_WIDTH`、`aoko-figure.ts` 的 `PAD` 算出），`cwebp -q 94 -sharp_yuv -alpha_q 100 -exact`：质量再低，色带会被压缩带回来。

有珠那张的抠图全链（去字、钥匙和双眼的保留遮罩、毛球、轮廓去蓝）是有珠母图目录里的 scripts/run_matte.sh，目录位置见本机记忆 aoko-face-pipeline。

## 2 绑定图与位移场

`public/mascots/aoko-rig.png` 是半分辨率的权重图：R 头发、G 裙摆、B 头部。`aoko-figure.ts` 的片元着色器按权重对每个像素反向取样：头发是沿发丝传播的正弦波，裙摆按 x 错开相位，头部绕颈部转，呼吸是腰线以上整体抬升加胸口横向微扩。

权重怎么画：

1. 颜色只给候选：棕发按色相、饱和度、明度圈，但袖子、黑丝、靴子也会被当成头发。所以在 64 px 网格图上量出手、手臂、躯干的多边形，从候选里扣掉。颜色根本分不开时（有珠是黑发配黑衣），直接在网格图上量发片多边形，发根取帽檐或发旋，按离发根的距离做渐变；脸的多边形模糊后扣掉，不然脸跟着头发动，表情格就对不上。
2. 头发区先闭运算连成片，再外扩约 45 px，最后做 σ≈28 的高斯模糊；离发根越远权重越大，靠近身体的地方柔和压低。
3. 裙摆取腰线以下最大的一块红色，补洞、外扩后 σ≈14 模糊，越往下摆越大。头部是一个椭圆，σ≈22 模糊。

权重边缘只模糊几个像素、再叠高频谐波时，切口正好落在发丝之间和发梢上，发梢会打折、勾成钩（lyjw：「头发太奇怪了」）。大范围模糊、去掉谐波后，整缕一起弯。

验收：连拍 40 帧算逐像素标准差，只有飘发和裙摆亮，腿和靴子不动；再逐帧看发梢。旧的绑定图脚本存档在本机母图目录。新角色还没进站点、没有 WebGL 可截时，照着色器里头发、裙摆、头部三项的原式在 numpy 里做位移，连拍算标准差，先验权重图；集成后再用 capture.mjs 复验。有珠母图目录的 scripts/rig_sim.py 就是一份，是照当时的着色器抄的，用之前和 `aoko-figure.ts` 对一遍。

换角色时，按青子量出的坐标要在新母图上逐个重量，分两组：
- 立绘本身：
  - `aoko-figure.ts` 片元着色器里直接写成数字的：颈部转轴、头发左右分界（`lft`）、呼吸的胸口和腰线起伏带、胸口中线、眨眼用的两眼椭圆和眼线高度、施法时的眼睛发光椭圆（`eL`、`eR`，和眨眼那组不是一组）、两个眼睛高光点（`glint`）、脚部辉光带的起点。
  - 常量：`CHIN_Y`、`aoko-face.ts` 的 `FACE_BOX`、`aoko-fx.ts` 的 `FLOOR`（地面法阵的圆心，就是脚底）。
  - 重打光的配色 `SHADE`、`TINT`、`HIGH` 是按青子调的，换角色也要重调：有珠的预览页照搬后，棕靴在重打光下发灰蓝。
- 施法动作：`ARM_BOX`、`PALM`、`ORB`、手层的窗口 `wg`、手臂三环的 `aoko-rings.ts#FOREARM`。这组绑的是青子伸手放光球的动作，新角色的施法设计定了再量。

清单会跟着代码变，量之前用 `rg -n "[0-9]{3}\.[,)]" src/components/space-backdrop/aoko*.ts` 把着色器里写死的数字扫一遍。量完把这些点和区域画在立绘上，出一张标注图，一眼就能核对。

## 3 表情与眨眼

`aoko-face.ts` 的图集是 `FACE_COLS` × `FACE_ROWS` 格，每格盖在原图 `FACE_BOX` 那块正方形上，alpha 是只盖眉眼和嘴的羽化遮罩。`FACES` 里每个表情两个格号：`tile` 是睁眼时叠的格（-1 是原图），`shut` 是眨眼时眼皮合向的格（-1 是不眨）。

加一个表情：

1. **底图**。所有格都以同一张脸部底图 face_open 为底，母图目录里有；丢了就重裁：
   `uv run -q --with numpy --with scipy --with pillow python -I $SK/face_patch.py crop <2 倍母图> face_open.png --face-ts src/components/space-backdrop/aoko-face.ts`
   新角色还没有自己的 face.ts 时，在母图目录写一份临时 ts，只含 `FACE_BOX`、`FACE_COLS`、`FACE_ROWS`、`FACES`；`--face-ts` 指向它，`--src-w` 填 1 倍框宽。集成时并进 `src/`。
2. **挑表情**。站上整张脸约 88 CSS px、眼睛约 9 px。读得出的是嘴的开合、闭眼、单眼眨、眉角、笑眼；平静和微皱眉这种差别读不出，不值得占一格。参考图从素材库的立绘里找（位置见本机记忆 mahoyo-asset-library）：文件名 `AOK_<A|L|M|N|S>_<服装>_<姿势>_<表情>`，N 是脸部特写、做参考最清楚；服装 04 是站上这身红裙长靴；同一姿势的各表情身体逐像素一致；小写的 `aok_*` 是加了模糊描边的演出版，不用。别的角色前缀不同，有珠是 `ARI_`。认服装号时，每套服装取一张 A 立绘拼起来，一眼就能认出海报那身（有珠蓝底海报那身是服装 13）。
3. **Codex 改脸**。照 `$SK/face-brief.md` 写提示词，每个表情一个工作目录：
   ```sh
   codex features list | grep image_generation   # 要是 true
   cd <工作目录> && timeout 1500 codex exec --skip-git-repo-check -s workspace-write -C . "$(cat brief.md)" -i face_open.png -i expression_ref.png < /dev/null > codex_run.log 2>&1
   ```
   提示词放在 `-i` 前面：`-i` 吞后面所有参数，放在后面时 Codex 会停下来等标准输入。单张约 4 到 6 分钟，可以几张并行，放后台跑。
   结尾的 `< /dev/null` 也别省：用 Claude Code 的后台命令跑时，不关标准输入，Codex 会一直等，到超时也不出图。卡住了先看日志最后一行，停在 `Reading additional input from stdin...` 就是这个原因。
   换角色时，模板里第 1 张图那段和 Rules 里写死的青子特征（蓝眼睛、手套、眉毛和嘴）都要照新角色改；照抄的话，Codex 会往青子的蓝眼睛上靠。
   模板里「只生成一次、生成后立刻保存」那句别删：没有它时 Codex 有时出了一张又接着重画，拖到超时，工作目录里什么都没有。真超时了，先去 `~/.codex/generated_images/` 找它已经出的那张。
4. **配套闭眼格**。要眨眼的表情另出一张闭眼图，以这个表情的 Codex 原图为底，不以喊叫脸为底，否则眨眼时眉毛会跳。各表情的 Codex 原图（1024）和参考图放在母图目录的 face-codex/<名字>/，新生成的也放进去，以后补闭眼格要用。闭眼写成「略向下弯的睫毛线」，明说不要 ^ ^ 笑眼、不要挤眼。不眨的表情（已经闭着、单眼眨、眼形和闭眼图差太多）`shut` 写 -1。
   为什么眉毛会跳：眼皮快闭到底时，着色器（`aoko-figure.ts` 片元着色器里的 `full`）把整张闭眼格连眉毛一起盖上去，所以闭眼格的眉毛必须和睁眼那格一致。`FACES` 里 `shut` 借用别的表情闭眼格的，都要核对。修法有两条：以这个表情的 Codex 原图为底出闭眼格，最稳；两张脸眼形相近时，也可以从现有闭眼格裁出只含眼睛的一块放进空格，不用跑 Codex：眉毛区透明，盖上去时眉毛留着当前表情的。
5. **对齐贴回**。`patch` 在 512 空间里穷举缩放 0.98–1.02、平移 ±8 px，只在五官以外算误差，再按遮罩边缘那一圈把 Codex 的整体偏色拉回来：
   `uv run -q --with numpy --with scipy --with pillow python -I $SK/face_patch.py patch face_open.png shy=<输出>.png shy_shut=<闭眼输出>.png:eyes --tiles <母图目录>/face-tiles`
   换角色先在 512 空间里量出两眼（含眉）和嘴的椭圆，用 `--eyes`、`--mouth` 传，默认值是青子的。`:eyes` 只取眉眼，嘴留给当前表情；`:mouth` 只取嘴，给眼睛不动、只张嘴的表情。现有各格的残差在 2.4 到 4.2；明显更大就重出，提示词里再强调取景、大小逐像素不动。打开 tiles 目录里的 check 对照图看接缝。不要整张贴：Codex 会把全图轻微重画一遍，只有遮罩内可用。
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

用 Codex 给同一只手出别的手势、角度时，提示词要写清每根手指往掌心一侧弯、弯到什么程度。不写会出反折的手指，lyjw 的原话：「那手指弄得跟鸡爪一样」「注意那个弯曲方向」。

## 5 场景特效与召唤贴图

- **量**：在原作整帧参考图上打 100 px 网格，量瞳距和各元素的圆心、半径，按「站上瞳距 ÷ 原作瞳距」换算（`aoko-fx.ts` 的 `SHOT_K`）。同一帧再出一张 `magick -edge` 黑白边缘图，看清光环、符文带和手臂环的轮廓。
- **找素材**：先翻 Jev 编目的分类拼图（位置见本机记忆 mahoyo-asset-library），格下有文件名。编目没有的，对小图跑 `magick` 统计（alpha 均值、压到黑底后的蓝减红），挑出透明、偏蓝青、够大的，再 `magick montage` 拼对照表，派 Haiku 子代理逐格描述。带 `_aa_bb` 后缀的多是同一张的缩放、模糊变体。
- **导出**：改 `scripts/aoko-fx-assets.ts` 的 `CIRCLES`、`BOLTS`、`CUES` 表再重跑；`CUES` 要和 `aoko-summon.ts` 的同名表一起改。HD 比 2 倍屏显示尺寸还小的才标 `sr` 超分；发光线稿超分明显好于直接放大，SVG 描边会把光晕糊成一团。webp 的透明通道质量用 50：到 80 以上 libwebp 近乎按无损存，体积翻倍，肉眼看不出差别。
- **加载**：默认页面一张特效贴图都不加载，按下秘技第一个键才预取。

lyjw 改过的地方，再动这些元素时照着来：

- 手臂三环是沿前臂排开的竖向窄椭圆，大小照原作不一样大，靠手腕的半圈被袖子和手挡住。
- 环附近只要一点点扭曲：「波动不是这样加的，有点点扭曲就行」，不画同心水波圈。
- 身后光环的呼吸缩放要轻：「速度和幅度都调低，微微有就行」。
- 地面法阵是一块真的水平面（`aoko-floor.ts`），近大远小由相机给；改法阵的压扁、近大远小就改 `aoko-fx.ts` 的 `FLOOR`，相机跟着反推（`aoko-stage.ts`）。
- 前景光（手臂环、电弧、光炮）先在离屏层里叠加，再整张按 source-over 盖到立绘上：光越亮底下压得越多，和直接加亮不是一个观感。
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
- 回退照现有写法守住，新角色也一样：只在深色模式挂（`space-backdrop.tsx`）；左侧留白窄于 `scene.ts` 的 `AOKO_MIN_GUTTER` 不挂；减少动态效果只画一帧、不开动画循环；没有 WebGL2 或着色器失败时换一张 2D 画布画静态原图（`aoko.ts` 里的 `fallback`）。three 只在按下秘技后动态加载，默认页面的包里不能有它：`pnpm build` 后在 `build/client/assets` 里查 `WebGLRenderer` 只落在召唤时才加载的那一块。
- 新增或重导的贴图在 PR 里写上 `public/mascots/` 的体积增减；比同类大一截就先降尺寸或质量。
- 新角色还没定进不进站点、只看效果时，另起一个独立预览页，在真 WebGL 里验：照 `aoko-figure.ts` 着色器里和施法无关的部分（呼吸、头部、头发、裙摆、表情格、眼皮、闲置重打光）搭，常量换成新角色的，用 URL 参数（`?face=`、`lid=`、`t=`）代替临时钩子。手抄的着色器会和 `aoko.ts` 慢慢对不上，用之前对一遍；有珠母图目录的 preview/ 就是一份。
- 接缝、发梢、手腕这些地方放大看；能拼成对照图的（改前改后、各格并排）拼起来一起发。
- 交付前删掉临时钩子（`rg -n "__aoko" src` 为空），PR 上的验证照 `lyjwpage-verify`。
