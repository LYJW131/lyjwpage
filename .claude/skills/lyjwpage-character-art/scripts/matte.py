#!/usr/bin/env python3
"""
精细抠图：BiRefNet 给粗遮罩，再按「已知背景色」逐像素反解透明度和前景色。
适合纯色或缓变背景的海报；发丝缝里透出的背景、半透明边都能干净拿掉。

  uv run -q --with numpy --with scipy --with pillow --with "rembg[cpu]" python -I matte.py <输入.png> <输出.png> \
      [--rough <BiRefNet 粗抠.png>] [--bg blue | --bg <hex>:<容差>] [--detext <hex>] [--keep <遮罩.png>] [--crop x0,y0,x1,y1]

--rough 省掉时现场跑 rembg 的 birefnet-general（首次会下载模型）。
--bg blue 是蓝底海报的判据；别的纯色底写成 --bg 24231f:40（与该色的 RGB 距离小于 40 算背景）。
--detext 先把人物外（粗抠 α<0.5）的白字外扩 3 px、涂成这个底色再抠：贴着轮廓的白字会把局部底色估白，字和轮廓之间的缝就反解成半透明的底色点。
--keep 是和输入同尺寸的黑白遮罩（白 = 保留）：人物身上和底色同色系的部件、粗抠漏掉的小物件，按原色不透明贴回。遮罩用 keepmask.py 做。
"""
import argparse
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, binary_erosion, gaussian_filter, uniform_filter


def box(x, r):
    return uniform_filter(x, size=2 * r + 1)


def masked_mean(img, mask, radii):
    # 由小到大的窗口逐级补：近处有已知像素就用近处的，没有才往远处取。
    out = np.zeros_like(img)
    got = np.zeros(mask.shape, bool)
    for r in radii:
        w = box(mask.astype(np.float32), r)
        est = np.stack([box(np.where(mask, img[..., c], 0), r) for c in range(3)], -1) / np.maximum(w, 1e-6)[..., None]
        new = (w > 1e-4) & ~got
        out[new] = est[new]
        got |= new
    return out


def bg_like(img, rule):
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    if rule == "blue":
        return (b - np.maximum(r, g) > 45) & (g < 130)
    hex_, _, tol = rule.partition(":")
    ref = np.array(list(bytes.fromhex(hex_)), np.float32)
    return np.linalg.norm(img - ref, axis=-1) < float(tol or 40)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--rough")
    ap.add_argument("--bg", default="blue")
    ap.add_argument("--detext")
    ap.add_argument("--keep")
    ap.add_argument("--crop")
    args = ap.parse_args()

    src = Image.open(args.src).convert("RGB")
    if args.rough:
        rough = Image.open(args.rough)
    else:
        from rembg import new_session, remove

        rough = remove(src, session=new_session("birefnet-general"))
    img = np.asarray(src).astype(np.float32)
    a0 = np.asarray(rough.convert("RGBA"))[..., 3].astype(np.float32) / 255
    orig = img.copy()
    if args.detext:
        outside = a0 < 0.5
        text = binary_dilation((img.min(-1) > 120) & outside, iterations=3) & outside
        img[text] = list(bytes.fromhex(args.detext))

    bgc = bg_like(img, args.bg)
    solid = binary_erosion(a0 > 0.9, iterations=4) & ~bgc
    known_bg = ~binary_dilation(a0 > 0.1, iterations=6) | ((a0 < 0.5) & bgc)
    B = masked_mean(img, known_bg, (16, 40, 120, 400))
    F = masked_mean(img, solid, (4, 10, 20, 40, 80))
    unknown = ~solid & ~known_bg
    d = F - B
    # α = (I−B)·(F−B) / |F−B|²：把像素投影到「局部背景 → 邻近前景」这条线上。
    alpha = np.clip(((img - B) * d).sum(-1) / np.maximum((d * d).sum(-1), 1), 0, 1)
    # 边带只信反解，但不许比模型实太多，免得把背景当前景。
    alpha = np.where(unknown, np.minimum(alpha, np.clip(a0 * 1.6 + 0.1, 0, 1)), np.where(solid, 1.0, 0.0))
    alpha[box(alpha, 2) < 0.12] = 0
    a = np.maximum(alpha, 1e-3)[..., None]
    fg = np.clip((img - (1 - a) * B) / a, 0, 255)
    # 越透明的像素越靠邻近前景色：反解在 α 小时会放大噪点，发丝边缘出黄边。
    k = np.clip((alpha - 0.3) / 0.5, 0, 1)[..., None]
    fg = np.where(solid[..., None], img, k * fg + (1 - k) * F)

    if args.keep:
        keep = np.asarray(Image.open(args.keep).convert("L")) > 127
        if keep.shape != alpha.shape:
            sys.exit(f"--keep 遮罩 {keep.shape[::-1]} 要和输入 {alpha.shape[::-1]} 同尺寸")
        soft = np.clip(gaussian_filter(binary_erosion(keep).astype(np.float32), 1.2), 0, 1)
        alpha = np.maximum(alpha, soft)
        fg = fg * (1 - soft[..., None]) + orig * soft[..., None]

    out = Image.fromarray(np.dstack([fg.round().astype(np.uint8), (alpha * 255).round().astype(np.uint8)]), "RGBA")
    if args.crop:
        out = out.crop(tuple(int(v) for v in args.crop.split(",")))
    out.save(args.out)
    print(f"{args.out}: {out.size[0]}×{out.size[1]}")


if __name__ == "__main__":
    main()
