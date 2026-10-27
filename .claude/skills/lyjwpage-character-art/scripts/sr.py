#!/usr/bin/env python3
"""
海报超分：Real-ESRGAN anime 6B 放大 4 倍，再缩到母图要的尺寸。只跑 RGB 一遍，给不透明的海报用；
透明的演出图层用仓库的 scripts/aoko-fx-sr.py，它把颜色和透明度各跑一遍。先裁人物框再超分，省时间也省内存。

  uv run -q --with torch --with spandrel --with pillow --with numpy python -I sr.py <权重.pth> <海报> <输出.png> --scale 2 [--crop x0,y0,x1,y1]

--scale 相对裁出的那块的原尺寸，母图要多大就填多少。青子的海报约等于 1 倍代码框，填 2；
有珠的海报本身已是 2 倍量级，填 1，这时超分只用来去 JPEG 噪点、把线条变干净。
"""
import argparse
import time

import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

TILE = 384
OVERLAP = 24


def upscale(model, a, dev):
    h, w, _ = a.shape
    s = model.scale
    out = np.zeros((h * s, w * s, 3), np.float32)
    with torch.no_grad():
        for y in range(0, h, TILE):
            for x in range(0, w, TILE):
                y0, x0 = max(0, y - OVERLAP), max(0, x - OVERLAP)
                y1, x1 = min(h, y + TILE + OVERLAP), min(w, x + TILE + OVERLAP)
                t = torch.from_numpy(np.ascontiguousarray(a[y0:y1, x0:x1])).permute(2, 0, 1)[None].to(dev)
                r = model(t)[0].permute(1, 2, 0).clamp(0, 1).float().cpu().numpy()
                th, tw = min(TILE, h - y) * s, min(TILE, w - x) * s
                oy, ox = (y - y0) * s, (x - x0) * s
                out[y * s : y * s + th, x * s : x * s + tw] = r[oy : oy + th, ox : ox + tw]
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("weights")
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--scale", type=float, required=True)
    ap.add_argument("--crop")
    args = ap.parse_args()

    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    model = ModelLoader().load_from_file(args.weights).to(dev).eval()
    im = Image.open(args.src).convert("RGB")
    if args.crop:
        im = im.crop(tuple(int(v) for v in args.crop.split(",")))
    t0 = time.time()
    big = upscale(model, np.asarray(im).astype(np.float32) / 255, dev)
    size = (round(im.width * args.scale), round(im.height * args.scale))
    Image.fromarray((big * 255).round().astype(np.uint8)).resize(size, Image.LANCZOS).save(args.out)
    print(f"{args.out}: {size[0]}×{size[1]}（{dev}，{time.time() - t0:.0f}s）")


if __name__ == "__main__":
    main()
