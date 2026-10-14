#!/usr/bin/env python3
import argparse
import json
import os

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view as swv
from PIL import Image

HELP = """标出只闪一帧的毛病：第 i 帧里有、前后两帧都解释不了的东西（小标签缺一帧、跳位又跳回、单帧残影）。

  python3 docs/explainer/v2/tools/flicker.py <帧目录> <输出.tsv> [--from 帧] [--to 帧] [--tau 6]

拼图给 Haiku 看时这类毛病最容易漏，所以另用像素比对兜底；输出每行：帧号、章:小节、能量、解释不了的部分、x、y（960 宽画面坐标），逐个打开那一帧和前后帧核对。

做法：帧先 2 倍降采样去掉颗粒；每三帧 (a, b, c) 取逐像素中位数当背景，b 减背景剩下的是只在 b 里有的东西。
12 px 窗口（960 画面里 24 px）里这部分能量超过 tau、且在 ±20 px（960 画面里 40 px）内平移 a 或 c 的对应部分都对不上，就标出来。
静止背景上的平移、淡入淡出、揭开、硬切都放过；前后两帧几乎处处不同（甩镜头）的那一帧跳过。"""

W, S, R = 12, 6, 20


def load(p):
    return np.asarray(Image.open(p).convert("L").reduce(2), dtype=np.float32)


def wmean(d):
    h, w = d.shape
    ii = np.cumsum(np.cumsum(np.pad(d, ((1, 0), (1, 0))), 0), 1)
    ys, xs = np.arange(0, h - W + 1, S), np.arange(0, w - W + 1, S)
    y0, x0 = np.meshgrid(ys, xs, indexing="ij")
    return (ii[y0 + W, x0 + W] - ii[y0, x0 + W] - ii[y0 + W, x0] + ii[y0, x0]) / (W * W), y0, x0


def best(p, q, y, x):
    pw = p[y:y + W, x:x + W]
    reg = q[max(0, y - R):y + W + R, max(0, x - R):x + W + R]
    return float(np.abs(swv(reg, (W, W)) - pw).mean(axis=(2, 3)).min())


def main():
    ap = argparse.ArgumentParser(description=HELP, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames_dir")
    ap.add_argument("out")
    ap.add_argument("--from", dest="lo", type=int, default=0)
    ap.add_argument("--to", dest="hi", type=int, default=10**9)
    ap.add_argument("--tau", type=float, default=6.0)
    a = ap.parse_args()

    film = json.load(open(os.path.join(a.frames_dir, "film.json")))
    starts = [c["t0"] / film["BAR"] for c in film["chapters"]]

    def where(f):
        bar = f / film["fps"] / film["BAR"]
        k = max(i for i, s in enumerate(starts) if s <= bar + 1e-9)
        return f"{film['chapters'][k]['id']}:{bar - starts[k]:.2f}"

    seq = sorted(int(n[:5]) for n in os.listdir(a.frames_dir) if n.endswith(".jpg") and n[:5].isdigit())
    seq = [f for f in seq if a.lo <= f < a.hi]
    path = lambda f: os.path.join(a.frames_dir, f"{f:05d}.jpg")
    rows = []
    fa, fb = load(path(seq[0])), load(path(seq[1]))
    for k in range(1, len(seq) - 1):
        fc = load(path(seq[k + 1]))
        d0, _, _ = wmean(np.abs(fc - fa))
        if (d0 > a.tau).mean() < 0.3:
            med = np.median(np.stack([fa, fb, fc]), axis=0)
            a1, b1, c1 = fa - med, fb - med, fc - med
            e, y0, x0 = wmean(np.abs(b1))
            cand = np.argwhere(e > a.tau)
            top = None
            for jy, jx in cand[np.argsort(-e[cand[:, 0], cand[:, 1]])][:200]:
                y, x = int(y0[jy, jx]), int(x0[jy, jx])
                rest = min(best(b1, a1, y, x), best(b1, c1, y, x))
                if rest > 0.6 * e[jy, jx] and (top is None or rest > top[0]):
                    top = (rest, float(e[jy, jx]), x * 2, y * 2)
            if top:
                rows.append((f"{seq[k]:05d}", where(seq[k]), round(top[1], 1), round(top[0], 1), top[2], top[3]))
        fa, fb = fb, fc
    with open(a.out, "w") as out:
        for r in rows:
            out.write("\t".join(map(str, r)) + "\n")
    print(len(seq), "帧，标出", len(rows))


if __name__ == "__main__":
    main()
