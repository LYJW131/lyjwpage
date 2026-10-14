#!/usr/bin/env python3
import argparse
import collections
import json
import sys

HELP = """在 textlog.mjs 的逐帧文字记录里找三类毛病，按段打印：帧号、章:小节、字、包围盒（1920×1080 坐标）、透明度。

  python3 docs/explainer/v2/tools/textcheck.py <记录.jsonl> [更多段.jsonl …] [--min-alpha 0.35]

  字压字    两段字的包围盒（上下各去掉约两成留白）重叠超过较小一段的 8%；同一行逐字画的字先拼回一段再比
  出画      字一部分在画面里、一部分越过边缘，连续至少 4 帧几乎不动（在动的是飞入飞出，不算）
  单帧跳变  同一段字前后两帧在同一处，夹在中间的那帧不见了、挪了位或透明度掉到一半以下

只看透明度不低于 --min-alpha 的字。结果是线索不是结论：逐条打开那几帧核对，故意叠放、故意出画的照设计放过。"""


def tight(it):
    _, x0, y0, x1, y1, _ = it
    h = y1 - y0
    return (x0, y0 + 0.18 * h, x1, y1 - 0.2 * h)


def inter(a, b):
    w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    return (w, h) if w > 0 and h > 0 else None


def area(r):
    return max(0, r[2] - r[0]) * max(0, r[3] - r[1])


def merge_lines(items):
    # 旁白和终端字是一个字一个字画的，同一基线上紧挨着的单字先拼回一段，不然每两个相邻字都算「字压字」。
    out = []
    for it in sorted(items, key=lambda it: (it[2], it[4], it[1])):
        if out:
            p = out[-1]
            if p[2] == it[2] and p[4] == it[4] and abs(it[1] - p[3]) <= 4 and len(it[0]) <= 2 and abs(p[5] - it[5]) < 0.01:
                out[-1] = [p[0] + it[0], p[1], p[2], max(p[3], it[3]), p[4], p[5]]
                continue
        out.append(list(it))
    return out


def runs(fs, gap):
    out = []
    for f in sorted(set(fs)):
        if out and f - out[-1][1] <= gap:
            out[-1][1] = f
        else:
            out.append([f, f])
    return out


def main():
    ap = argparse.ArgumentParser(description=HELP, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("logs", nargs="+")
    ap.add_argument("--min-alpha", type=float, default=0.35)
    a = ap.parse_args()
    mina = a.min_alpha

    head, frames = None, {}
    for p in a.logs:
        with open(p) as fh:
            h = json.loads(fh.readline())
            if head and h["lang"] != head["lang"]:
                sys.exit(f"{p} 是 {h['lang']} 版，前面的记录是 {head['lang']} 版，分开查")
            head = head or h
            for line in fh:
                f, items = json.loads(line)
                frames[f] = items
    seq = sorted(frames)
    step = min((y - x for x, y in zip(seq, seq[1:])), default=1)
    starts = [c["t0"] / head["BAR"] for c in head["chapters"]]

    def where(f):
        bar = f / head["fps"] / head["BAR"]
        k = max(i for i, s in enumerate(starts) if s <= bar + 1e-9)
        return f"{head['chapters'][k]['id']}:{bar - starts[k]:.2f}"

    over, clip = collections.defaultdict(list), collections.defaultdict(list)
    for f in seq:
        its = merge_lines([it for it in frames[f] if it[5] >= mina and it[0].strip()])
        for i, x in enumerate(its):
            tx = tight(x)
            inside = x[1] < 1920 and x[3] > 0 and x[2] < 1080 and x[4] > 0
            if inside and (x[1] < -2 or x[3] > 1922 or x[2] < -2 or x[4] > 1082):
                clip[x[0]].append((f, x))
            for y in its[i + 1:]:
                ty = tight(y)
                r = inter(tx, ty)
                if not r:
                    continue
                same_spot = abs(x[1] - y[1]) <= 3 and abs(x[2] - y[2]) <= 3
                if same_spot and (x[0] == y[0] or x[0].startswith(y[0]) or y[0].startswith(x[0])):
                    continue
                if abs(x[2] - y[2]) <= 1 and abs(x[4] - y[4]) <= 1 and r[0] <= 5:
                    continue
                ratio = r[0] * r[1] / max(1, min(area(tx), area(ty)))
                if ratio >= 0.08:
                    over[tuple(sorted([x[0], y[0]]))].append((f, round(ratio, 2), x, y))

    print(f"=== 字压字（透明度 ≥ {mina}）")
    rows = []
    for lst in over.values():
        byf = {}
        for f, r, x, y in lst:
            byf.setdefault(f, (r, x, y))
        for s, e in runs(byf, 2 * step):
            r, x, y = max((byf[f] for f in byf if s <= f <= e), key=lambda v: v[0])
            rows.append((s, e, r, x, y))
    for s, e, r, x, y in sorted(rows):
        print(f"{s:05d}-{e:05d} {where(s)} 最多重叠 {r:.2f} | {x[0][:40]!r} {x[1:5]} a{x[5]} | {y[0][:40]!r} {y[1:5]} a{y[5]}")

    print("\n=== 出画（至少 4 帧不动）")
    for t, lst in clip.items():
        byf = dict(lst)
        for s, e in runs(byf, step):
            seg = [byf[f] for f in sorted(byf) if s <= f <= e]
            if len(seg) < 4:
                continue
            moved = max(abs(seg[i][1] - seg[i - 1][1]) + abs(seg[i][2] - seg[i - 1][2]) for i in range(1, len(seg)))
            if moved <= 6:
                x = seg[len(seg) // 2]
                print(f"{s:05d}-{e:05d} {where(s)} {len(seg)} 帧 {t[:50]!r} {x[1:5]} a{x[5]}")

    print("\n=== 单帧跳变")

    def by_text(f):
        d = collections.defaultdict(list)
        for it in merge_lines([it for it in frames[f] if it[0].strip()]):
            d[it[0]].append(it)
        return d

    near = lambda u, v: abs(u[1] - v[1]) <= 3 and abs(u[2] - v[2]) <= 3
    for f0, f1, f2 in zip(seq, seq[1:], seq[2:]):
        if f2 - f0 != 2 * step:
            continue
        before, mid, after = by_text(f0), by_text(f1), by_text(f2)
        for t, lst in before.items():
            for x in lst:
                if x[5] < mina:
                    continue
                c = [y for y in after.get(t, []) if near(x, y) and y[5] >= mina]
                if not c:
                    continue
                m = [y for y in mid.get(t, []) if near(x, y)]
                if not m:
                    other = mid.get(t, [])
                    kind = f"挪位 → {other[0][1:5]}" if other else "不见"
                    print(f"{f1:05d} {where(f1)} {kind} {t[:50]!r} 原在 {x[1:5]} a{x[5]}")
                elif min(y[5] for y in m) < 0.5 * x[5] and c[0][5] > 0.8 * x[5]:
                    print(f"{f1:05d} {where(f1)} 变淡 {t[:50]!r} 透明度 {x[5]} → {min(y[5] for y in m)} → {c[0][5]}")


if __name__ == "__main__":
    main()
