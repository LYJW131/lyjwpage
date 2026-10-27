#!/usr/bin/env python3
"""
保留遮罩：人物身上和底色同色系的部件（蓝底海报上的蓝宝石、蓝灰虹膜），颜色判据和粗抠都分不开，抠图会把它们抠穿。
框内取「离底色远、又不是白字」的像素（金边、描边、别色宝石），闭运算连起来，再填满被它们围住的同色面。结果交给 matte.py --keep。

  uv run -q --with numpy --with scipy --with pillow python -I keepmask.py <超分图> <输出.png> --box x0,y0,x1,y1 --bg 1a34aa [--t 45] [--add 已有遮罩.png]

--hole-max 只填面积小于它的洞：被发丝围住的底色三角也算洞，全填就把底色当成了人物。
--chroma 另要求不偏蓝（b−max(r,g) ≤ 45），给和半透明发丝混在一起的小物件（毛球）用。
眼睛这类没有描边围住的，在遮罩上直接画椭圆（magick -draw "ellipse cx,cy rx,ry 0,360"），再用 --add 并进来。
"""
import argparse

import numpy as np
from PIL import Image
from scipy.ndimage import binary_closing, binary_fill_holes, binary_opening, label


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--box", required=True)
    ap.add_argument("--bg", required=True)
    ap.add_argument("--t", type=float, default=45)
    ap.add_argument("--close", type=int, default=3)
    ap.add_argument("--hole-max", type=int, default=0)
    ap.add_argument("--chroma", action="store_true")
    ap.add_argument("--add")
    args = ap.parse_args()

    img = np.asarray(Image.open(args.src).convert("RGB")).astype(np.float32)
    x0, y0, x1, y1 = map(int, args.box.split(","))
    sub = img[y0:y1, x0:x1]
    bg = np.array(list(bytes.fromhex(args.bg)), np.float32)
    white = sub.min(-1) > 170
    edge = (np.linalg.norm(sub - bg, axis=-1) > args.t) & ~white
    if args.chroma:
        edge &= (sub[..., 2] - np.maximum(sub[..., 0], sub[..., 1])) <= 45
    ring = binary_closing(edge, iterations=args.close)
    mask = binary_fill_holes(ring) & ~(white & ~ring)
    if args.hole_max:
        holes, _ = label(mask & ~ring)
        size = np.bincount(holes.ravel())
        mask = ring | ((holes > 0) & (size[holes] < args.hole_max))
    mask = binary_opening(mask, iterations=1)

    out = np.asarray(Image.open(args.add).convert("L")).copy() if args.add else np.zeros(img.shape[:2], np.uint8)
    out[y0:y1, x0:x1] = np.maximum(out[y0:y1, x0:x1], mask * 255)
    Image.fromarray(out).save(args.out)
    print(f"{args.out}: {int(mask.sum())} px")


if __name__ == "__main__":
    main()
