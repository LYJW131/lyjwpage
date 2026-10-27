#!/usr/bin/env python3
"""
把 Codex 补画的那块贴回超分图。只贴洋红区，并上 --block 圈出的整块部件，其余保持原图：Codex 会把整张轻微重画一遍。
被挡的部件要整块换：只贴洋红那块时，露在外面的半截和 Codex 画的形状对不上，有珠的鞋跟就拼成了两个。

  uv run -q --with numpy --with scipy --with pillow python -I paste_patch.py <超分图> <Codex 输出> <涂了洋红的裁图> <输出.png> --at x0,y0,边长 [--block x0,y0,x1,y1]

--at 是裁图在超分图上的左上角和边长，Codex 输出和洋红裁图都按这个边长缩放；--block 用裁图内、按这个边长计的坐标。
打印的「遮罩外平均差」是 Codex 在遮罩外重画的幅度，几个点以内说明对得上；明显更大就是改了构图，要重出。
"""
import argparse

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, gaussian_filter


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("base")
    ap.add_argument("fixed")
    ap.add_argument("marked")
    ap.add_argument("out")
    ap.add_argument("--at", required=True)
    ap.add_argument("--block")
    args = ap.parse_args()

    x0, y0, side = map(int, args.at.split(","))
    base = np.asarray(Image.open(args.base).convert("RGB")).astype(np.float32)
    sub = base[y0 : y0 + side, x0 : x0 + side]
    fixed = np.asarray(Image.open(args.fixed).convert("RGB").resize((side, side), Image.LANCZOS)).astype(np.float32)
    marked = np.asarray(Image.open(args.marked).convert("RGB").resize((side, side), Image.NEAREST)).astype(np.int16)
    r, g, b = marked[..., 0], marked[..., 1], marked[..., 2]
    mask = binary_dilation((r > 200) & (g < 80) & (b > 200), iterations=3)
    if args.block:
        bx0, by0, bx1, by1 = map(int, args.block.split(","))
        mask[by0:by1, bx0:bx1] = True
    w = np.clip(gaussian_filter(mask.astype(np.float32), 2.0) * 1.5, 0, 1)[..., None]
    outside = ~binary_dilation(mask, iterations=6)
    print(f"遮罩外平均差 {np.abs(fixed - sub)[outside].mean():.1f}/255")
    base[y0 : y0 + side, x0 : x0 + side] = sub * (1 - w) + fixed * w
    Image.fromarray(base.round().astype(np.uint8)).save(args.out)
    print(args.out)


if __name__ == "__main__":
    main()
