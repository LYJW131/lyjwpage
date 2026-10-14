#!/usr/bin/env python3
import argparse
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../.."))
BRIEF = os.path.join(ROOT, ".claude/skills/lyjwpage-explainer/frame-qa.md")
LAYOUT = {1: (1, 1), 2: (1, 2), 4: (2, 2), 6: (2, 3), 9: (3, 3)}
LABEL_H, GAP = 28, 6
# 标准档模型看图前，长边超过 1568 px 或超过 1568 个视觉 token（28×28 px 一块）的图会被缩小；拼图先缩进这个范围，
# 换哪档模型看都不会再被缩一次。两帧一张（960×1142）本来就在范围内，不缩。
MAX_EDGE, MAX_TOKENS, PATCH = 1568, 1568, 28

HELP = """把 frames.mjs 渲出的帧拼成带标签的验收图，每 --batch 张一批，每批写好派给 Haiku 的提示词。

  python3 docs/explainer/v2/tools/sheets.py <帧目录> <输出目录> [--from 帧] [--to 帧]
  python3 docs/explainer/v2/tools/sheets.py <帧目录> <输出目录> --changed-vs <旧帧目录>
  python3 docs/explainer/v2/tools/sheets.py <帧目录> <输出目录> --frames <帧号列表文件>

每批一个目录 <输出目录>/<tag><语种>-b<首帧号>/：s0000.jpg… 验收图、sheets.txt（图的路径）、frames.txt（帧号）、
prompt.md（派单提示词，照抄给 Agent）。批目录已经存在就停下不写，免得盖掉上次的图和报告。
只挑部分帧时，每段连续帧补成偶数，同一张图里的两格总是相邻的两帧。"""


def font():
    for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", "/System/Library/Fonts/Menlo.ttc"):
        if os.path.exists(path):
            return ImageFont.truetype(path, 21)
    return ImageFont.load_default(size=21)


def labeller(film):
    starts = [c["t0"] / film["BAR"] for c in film["chapters"]]

    def label(f):
        bar = f / film["fps"] / film["BAR"]
        k = max(i for i, s in enumerate(starts) if s <= bar + 1e-9)
        return f"{f:05d} {film['chapters'][k]['id']} {bar - starts[k]:.2f}"

    return label


def build(out, per, items):
    cols, rows = LAYOUT[per]
    os.makedirs(out, exist_ok=True)
    fw, fh = Image.open(items[0][0]).size
    th = fh + LABEL_H
    W, H = cols * fw + (cols - 1) * GAP, rows * th + (rows - 1) * GAP
    k = min(1.0, MAX_EDGE / max(W, H))
    while math.ceil(W * k / PATCH) * math.ceil(H * k / PATCH) > MAX_TOKENS:
        k *= 0.99
    ft, names = font(), []
    for s in range(0, len(items), per):
        sheet = Image.new("RGB", (W, H), (255, 255, 255))
        d = ImageDraw.Draw(sheet)
        for j, (path, label) in enumerate(items[s:s + per]):
            x, y = (j % cols) * (fw + GAP), (j // cols) * (th + GAP)
            d.text((x + 6, y + 2), label, font=ft, fill=(0, 0, 0))
            sheet.paste(Image.open(path).convert("RGB"), (x, y + LABEL_H))
        if k < 1:
            sheet = sheet.resize((round(W * k), round(H * k)), Image.LANCZOS)
        name = f"{out}/s{s // per:04d}.jpg"
        sheet.save(name, quality=90)
        names.append(name)
    return names


def changed(new, old):
    with open(new, "rb") as a, open(old, "rb") as b:
        return a.read() != b.read()


def runs_of(idx, per):
    out = []
    for i in idx:
        if out and i - out[-1][-1] <= per:
            out[-1].extend(range(out[-1][-1] + 1, i + 1))
        else:
            out.append([i])
    return out


def prompt(d, film, frames, step, n, per, focus, brief):
    # 帧目录头尾都没有能补的帧时，最后一张凑不满。
    tail = f"，最后一张只有 {len(frames) % per} 格" if len(frames) % per else ""
    lang = "英文版，每秒抽 6 帧（格子标签是 24 fps 的帧号，相邻两格差 4）" if film["lang"] == "en" else "中文版，24 帧每秒逐帧"
    p = [
        "不要调用任何 mcp__hearthbot__ 工具（包括 update_status、reply），只用 Read 看图、Write 写报告。",
        f"先用 Read 打开 {brief}，那是你的完整任务说明，照它做。",
        f"这一批是{lang}。要看的图：{d}/sheets.txt 里每行一个路径，共 {n} 张，每张拼 {per} 帧{'（上下两格）' if per == 2 else ''}{tail}。",
    ]
    segs, a = [], frames[0]
    for x, y in zip(frames, frames[1:]):
        if y != x + step:
            segs.append((a, x))
            a = y
    segs.append((a, frames[-1]))
    if len(segs) == 1:
        p.append(f"帧号从 {segs[0][0]:05d} 到 {segs[0][1]:05d} 连续。")
    else:
        p.append(f"帧号分 {len(segs)} 段：{'、'.join(f'{x:05d}–{y:05d}' for x, y in segs)}；段与段之间跳过了没改的帧，跨段的相邻两格不连续是正常的，段内帧号连续。")
    hits = [t["text"] for t in focus if t.get("lang", film["lang"]) == film["lang"] and any(x <= t["to"] and y >= t["from"] for x, y in segs)]
    if hits:
        p.append("这一批要特别注意：" + "".join(hits) + "其他问题照说明照常记。")
    p.append(f"报告文件：{d}/report.json")
    return "\n".join(p) + "\n"


def main():
    ap = argparse.ArgumentParser(description=HELP, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("frames_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--from", dest="lo", type=int, default=0)
    ap.add_argument("--to", dest="hi", type=int, default=10**9)
    ap.add_argument("--changed-vs", help="旧帧目录：只挑和它逐字节不同（或它没有）的帧；两边要在同一台机器上渲")
    ap.add_argument("--frames", help="帧号列表文件，一行一个")
    ap.add_argument("--per", type=int, default=2, choices=sorted(LAYOUT), help="每张拼几帧，默认 2（实测的甜点）")
    ap.add_argument("--batch", type=int, default=60, help="每批几张图，默认 60")
    ap.add_argument("--tag", default="", help="批目录名前缀，如 r2-")
    ap.add_argument("--focus", help='这一轮要特别注意什么，传 JSON 文件的路径，内容如 [{"from": 帧, "to": 帧, "lang": "zh", "text": "…"}]')
    ap.add_argument("--brief", default=BRIEF)
    a = ap.parse_args()

    film = json.load(open(os.path.join(a.frames_dir, "film.json")))
    label = labeller(film)
    path = lambda f: os.path.join(a.frames_dir, f"{f:05d}.jpg")
    seq = sorted(int(n[:5]) for n in os.listdir(a.frames_dir) if n.endswith(".jpg") and n[:5].isdigit())
    step = min((y - x for x, y in zip(seq, seq[1:])), default=1)
    pick = [f for f in seq if a.lo <= f < a.hi]
    if a.frames:
        want = {int(l) for l in open(a.frames) if l.strip()}
        pick = [f for f in pick if f in want]
    if a.changed_vs:
        old = lambda f: os.path.join(a.changed_vs, f"{f:05d}.jpg")
        pick = [f for f in pick if not os.path.exists(old(f)) or changed(path(f), old(f))]
        print(f"变了 {len(pick)} 帧", file=sys.stderr)
    if not pick:
        print("没有要看的帧", file=sys.stderr)
        return

    pos = {f: i for i, f in enumerate(seq)}
    review = []
    for run in runs_of([pos[f] for f in pick], a.per):
        if len(run) % a.per:
            extra = a.per - len(run) % a.per
            after = [i for i in range(run[-1] + 1, run[-1] + 1 + extra) if i < len(seq)]
            before = list(range(max(0, run[0] - (extra - len(after))), run[0]))
            run = before + run + after
        review += [seq[i] for i in run if not review or seq[i] > review[-1]]

    focus = json.load(open(a.focus)) if a.focus else []
    size = a.per * a.batch
    parts = [review[b0:b0 + size] for b0 in range(0, len(review), size)]
    dirs = [os.path.abspath(os.path.join(a.out_dir, f"{a.tag}{film['lang']}-b{part[0]:05d}")) for part in parts]
    taken = [d for d in dirs if os.path.exists(d)]
    if taken:
        sys.exit("批目录已存在，换个 --tag 或先删掉：\n" + "\n".join(taken))
    for part, d in zip(parts, dirs):
        names = build(d, a.per, [(path(f), label(f)) for f in part])
        open(f"{d}/sheets.txt", "w").write("\n".join(names) + "\n")
        open(f"{d}/frames.txt", "w").write("\n".join(map(str, part)) + "\n")
        open(f"{d}/prompt.md", "w").write(prompt(d, film, part, step, len(names), a.per, focus, a.brief))
        print(d, len(names), "张", f"{part[0]}..{part[-1]}")


if __name__ == "__main__":
    main()
