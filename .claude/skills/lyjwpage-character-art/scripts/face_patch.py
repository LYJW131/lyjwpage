#!/usr/bin/env python3
"""
立绘表情格：裁脸、把 Codex 改过的脸对齐贴回、按 FACES 拼图集。
格框、格数与格序从 --face-ts 读（FACE_BOX、FACE_COLS、FACE_ROWS、FACES），原图宽从同目录 aoko-figure.ts 的 SRC_W 读，
都是青子的文件；换角色时指向新角色的文件，或用 --src-w 直接给。

  py(){ uv run -q --with numpy --with scipy --with pillow python -I "$@"; }
  py face_patch.py crop <母图.png> <face_open.png> --face-ts <aoko-face.ts> [--src-w 934] [--bg 24231f]
  py face_patch.py patch <face_open.png> <名字>=<Codex 输出.png>[:eyes|:mouth] ... [--tiles 目录] [--eyes cx,cy,rx,ry/cx,cy,rx,ry] [--mouth cx,cy,rx,ry]
  py face_patch.py atlas <tiles 目录> <输出.webp> --face-ts <aoko-face.ts> --extra 0=angry_shut,7=relaxed_shut

patch 打印每格的对齐残差；check.png 是原脸和各格贴回后的横排对照。
:eyes 只贴眉眼（闭眼格），:mouth 只贴嘴（眼睛不动的表情），不加后缀两样都贴。
新角色还没有自己的 face.ts 时，在母图目录写一份只含 FACE_BOX、FACE_COLS、FACE_ROWS、FACES 的临时 ts 传给 --face-ts。
--eyes / --mouth 是 512×512 空间（face_open 缩到一半）里的椭圆：两眼各一个、含眉毛，嘴一个；默认值是青子的。
"""
import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, zoom

FACE_PX = 1024
TILE_PX = 256
# 对齐与遮罩在 512 空间里算：face_open（1024）的一半，FACE_BOX 边长的 2 倍。
N = 512
EYES = "174,242,90,74/340,246,90,74"
MOUTH = "255,388,64,50"
SCALES = (0.98, 0.985, 0.99, 0.995, 1.0, 1.005, 1.01, 1.015, 1.02)
SHIFT = 8


def read_face_ts(path):
    text = Path(path).read_text()
    box = re.search(r"FACE_BOX\s*=\s*\[(\d+),\s*(\d+),\s*(\d+)\]", text)
    cols = re.search(r"FACE_COLS\s*=\s*(\d+)", text)
    rows = re.search(r"FACE_ROWS\s*=\s*(\d+)", text)
    faces = {m[1]: (int(m[2]), int(m[3])) for m in re.finditer(r"(\w+):\s*\{\s*tile:\s*(-?\d+),\s*shut:\s*(-?\d+)\s*\}", text)}
    if not (box and cols and rows and faces):
        sys.exit(f"{path}: 没读到 FACE_BOX / FACE_COLS / FACE_ROWS / FACES")
    return tuple(map(int, box.groups())), int(cols[1]), int(rows[1]), faces


def src_width(args):
    if args.src_w:
        return args.src_w
    shader = Path(args.face_ts).with_name("aoko-figure.ts")
    m = re.search(r"const SRC_W = (\d+);", shader.read_text()) if shader.exists() else None
    if not m:
        sys.exit(f"没在 {shader} 里读到 SRC_W，用 --src-w 给原图宽")
    return int(m[1])


def crop(args):
    (x, y, side), _, _, _ = read_face_ts(args.face_ts)
    im = Image.open(args.master).convert("RGBA")
    k = im.width / src_width(args)
    face = im.crop((round(x * k), round(y * k), round((x + side) * k), round((y + side) * k)))
    # 现有各格都以这样裁出的同一张 face_open 为底（2 倍超分母图、叠深色底、LANCZOS），换了任何一样，新旧格的残差就不可比。
    bg = Image.new("RGBA", face.size, (*bytes.fromhex(args.bg), 255))
    Image.alpha_composite(bg, face).convert("RGB").resize((FACE_PX, FACE_PX), Image.LANCZOS).save(args.out)
    print(f"{args.out}: FACE_BOX {x},{y},{side} × {k:g}")


yy, xx = np.mgrid[0:N, 0:N]


def ellipse(spec):
    cx, cy, rx, ry = map(float, spec.split(","))
    return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2


def feather(d, blur=6):
    m = np.clip((1.0 - d) / 0.55 + 1, 0, 1)
    return np.clip(gaussian_filter(m, blur) * 1.15, 0, 1)


def load512(path):
    return np.asarray(Image.open(path).convert("RGB").resize((N, N), Image.LANCZOS)).astype(np.float32)


def align(base, out, region):
    best = None
    for s in SCALES:
        scaled = np.stack([zoom(out[..., c], s, order=1) for c in range(3)], -1)
        h = scaled.shape[0]
        if h >= N:
            o = (h - N) // 2
            scaled = scaled[o : o + N, o : o + N]
        else:
            p = N - h
            scaled = np.pad(scaled, ((p // 2, p - p // 2), (p // 2, p - p // 2), (0, 0)), mode="edge")
        for dy in range(-SHIFT, SHIFT + 1):
            for dx in range(-SHIFT, SHIFT + 1):
                moved = np.roll(np.roll(scaled, dy, 0), dx, 1)
                err = np.abs(moved - base)[region].mean()
                if best is None or err < best[0]:
                    best = (err, s, dy, dx, moved)
    return best


def patch(args):
    eye_d = np.minimum(*(ellipse(e) for e in args.eyes.split("/")))
    mouth_d = ellipse(args.mouth)
    feature_d = np.minimum(eye_d, mouth_d)
    masks = {"": feature_d, "eyes": eye_d, "mouth": mouth_d}
    base = load512(args.face_open)
    # 五官本来就被改了，误差只在五官以外、脸部上下范围内算。
    region = (feature_d > 2.0) & (yy > 120) & (yy < 480)
    tiles = Path(args.tiles)
    tiles.mkdir(parents=True, exist_ok=True)
    strip = [base]
    for spec in args.specs:
        name, _, rest = spec.partition("=")
        src, _, kind = rest.partition(":")
        if kind not in masks:
            sys.exit(f"{spec}：后缀只认 :eyes、:mouth")
        out = load512(src)
        err, s, dy, dx, moved = align(base, out, region)
        mask = feather(masks[kind])
        # 遮罩边缘那一圈把均值拉回原图：Codex 会整张轻微偏色，不校就是一块补丁。
        ring = (mask > 0.05) & (mask < 0.6)
        moved = moved + (base[ring].mean(0) - moved[ring].mean(0))
        rgba = np.dstack([np.clip(moved, 0, 255), mask * 255]).round().astype(np.uint8)
        Image.fromarray(rgba, "RGBA").resize((TILE_PX, TILE_PX), Image.LANCZOS).save(tiles / f"{name}.png")
        strip.append(base * (1 - mask[..., None]) + moved * mask[..., None])
        print(f"{name}: align err {err:.2f} (raw {np.abs(out - base)[region].mean():.2f}) scale {s} dy {dy} dx {dx}")
    Image.fromarray(np.hstack(strip).clip(0, 255).astype(np.uint8)).save(tiles / "check.png")


def atlas(args):
    _, cols, rows, faces = read_face_ts(args.face_ts)
    names = {tile: name for name, (tile, _) in faces.items() if tile >= 0}
    for pair in filter(None, args.extra.split(",")):
        k, _, v = pair.partition("=")
        names[int(k)] = v
    used = {i for t, s in faces.values() for i in (t, s) if i >= 0}
    over = sorted(i for i in used if i >= cols * rows)
    if over:
        sys.exit(f"格号 {over} 超出 {cols}×{rows} 的图集：先加大 FACE_ROWS 或 FACE_COLS")
    tiles = Path(args.tiles)
    missing = [f"{i}={names.get(i, '?')}" for i in sorted(used) if i not in names or not (tiles / f"{names[i]}.png").exists()]
    if missing:
        sys.exit(f"FACES 用到但缺图的格：{', '.join(missing)}（用 --extra 补上只当闭眼格的名字）")
    sheet = Image.new("RGBA", (cols * TILE_PX, rows * TILE_PX))
    for i in sorted(used):
        sheet.paste(Image.open(tiles / f"{names[i]}.png").convert("RGBA").resize((TILE_PX, TILE_PX), Image.LANCZOS), ((i % cols) * TILE_PX, (i // cols) * TILE_PX))
    # 中间 PNG 放临时目录：输出常是 public/mascots/，留在旁边会被当成新贴图提交上线。
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "atlas.png"
        sheet.save(png)
        subprocess.run(["magick", str(png), "-define", "webp:alpha-quality=100", "-quality", "92", args.out], check=True)
    print(f"{args.out}: {len(used)} 格 → " + " ".join(f"{i}:{names[i]}" for i in sorted(used)))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("crop")
    c.add_argument("master")
    c.add_argument("out")
    c.add_argument("--face-ts", required=True)
    c.add_argument("--src-w", type=int)
    c.add_argument("--bg", default="24231f")
    p = sub.add_parser("patch")
    p.add_argument("face_open")
    p.add_argument("specs", nargs="+")
    p.add_argument("--tiles", default="tiles")
    p.add_argument("--eyes", default=EYES)
    p.add_argument("--mouth", default=MOUTH)
    a = sub.add_parser("atlas")
    a.add_argument("tiles")
    a.add_argument("out")
    a.add_argument("--face-ts", required=True)
    a.add_argument("--extra", default="")
    args = ap.parse_args()
    {"crop": crop, "patch": patch, "atlas": atlas}[args.cmd](args)


if __name__ == "__main__":
    main()
