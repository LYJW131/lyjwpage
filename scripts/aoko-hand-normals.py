#!/usr/bin/env python3
"""
给青子伸出的手算法线图，供 aoko-figure.ts 着色器按掌前光炮打光。立绘是平面插画，没有几何：
把手的不透明区域按勾线切开（手指、掌心各成一块），每块按到边缘的距离鼓起来，边缘朝外、中间朝前。
法线图 RGB = 法线 xyz 映射到 0–1，A = 手的 alpha。

  # 输出与输入同尺寸的法线图（手层 public/mascots/aoko-arm.webp → aoko-arm-normal.webp）
  uv run -q --with numpy --with scipy --with pillow python -I scripts/aoko-hand-normals.py <手.png|webp> <输出.webp>
"""
import argparse
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter

# 鼓起的快慢（像素）：手指约 12 px 宽，离边 3 px 就基本朝前。
BULGE = 3.0
# 勾线：比这更暗的像素当块与块的分界。
LINE = 0.28
# 法线 xy 的放大倍数：越大侧面越斜、受光的明暗分得越开。
TILT = 2.2


def normals(rgba):
    alpha = rgba[..., 3]
    luma = rgba[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    region = (alpha > 0.5) & (luma > LINE)
    height = gaussian_filter(1 - np.exp(-distance_transform_edt(region) / BULGE), 0.8)
    gy, gx = np.gradient(height)
    n = np.dstack([-gx * TILT * BULGE, -gy * TILT * BULGE, np.ones_like(height)])
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return np.dstack([n * 0.5 + 0.5, alpha])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("out")
    try:
        a = ap.parse_args()
    except SystemExit:
        sys.exit(2)
    rgba = np.asarray(Image.open(a.src).convert("RGBA")).astype(np.float32) / 255
    out = normals(rgba)
    # 有损 90 与无损肉眼无差、着色器分档的边也不抖，体积约三分之一；透明通道质量 50 同 scripts/aoko-fx-assets.ts。
    Image.fromarray((out * 255).round().clip(0, 255).astype(np.uint8), "RGBA").save(a.out, quality=90, alpha_quality=50)


if __name__ == "__main__":
    main()
