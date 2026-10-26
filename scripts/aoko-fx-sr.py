#!/usr/bin/env python3
"""
给 scripts/aoko-fx-assets.ts 用的超分：把一张透明的演出图层用 Real-ESRGAN anime 6B 放大 4 倍（和青子立绘超分用的同一个模型）。
预乘色（压到黑底）与 alpha 各跑一遍，再反预乘拼回 RGBA：直接把 RGBA 喂给只认 RGB 的模型，半透明的光晕会被当成黑边放大。

  uv run -q --with torch --with spandrel --with pillow --with numpy python -I scripts/aoko-fx-sr.py <权重.pth> <输入.png> <输出.png>
"""
import sys

import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

TILE = 384
OVERLAP = 24


def main():
    if len(sys.argv) != 4:
        print(__doc__.strip(), file=sys.stderr)
        sys.exit(2)
    weights, src, out = sys.argv[1:]
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    model = ModelLoader().load_from_file(weights).to(dev).eval()

    def up(arr):
        h, w, _ = arr.shape
        s = model.scale
        res = np.zeros((h * s, w * s, 3), np.float32)
        with torch.no_grad():
            for y in range(0, h, TILE):
                for x in range(0, w, TILE):
                    y0, x0 = max(0, y - OVERLAP), max(0, x - OVERLAP)
                    y1, x1 = min(h, y + TILE + OVERLAP), min(w, x + TILE + OVERLAP)
                    tile = torch.from_numpy(np.ascontiguousarray(arr[y0:y1, x0:x1])).permute(2, 0, 1)[None].to(dev)
                    r = model(tile)[0].permute(1, 2, 0).clamp(0, 1).float().cpu().numpy()
                    ty, tx = (y - y0) * s, (x - x0) * s
                    th, tw = min(TILE, h - y) * s, min(TILE, w - x) * s
                    res[y * s : y * s + th, x * s : x * s + tw] = r[ty : ty + th, tx : tx + tw]
        return res

    im = np.asarray(Image.open(src).convert("RGBA")).astype(np.float32) / 255
    alpha = im[..., 3:4]
    rgb = up(im[..., :3] * alpha)
    a = up(np.repeat(alpha, 3, axis=2)).mean(axis=2, keepdims=True)
    color = np.where(a > 1e-3, np.clip(rgb / np.maximum(a, 1e-3), 0, 1), 0)
    Image.fromarray((np.concatenate([color, a], axis=2) * 255).round().astype(np.uint8), "RGBA").save(out)


if __name__ == "__main__":
    main()
