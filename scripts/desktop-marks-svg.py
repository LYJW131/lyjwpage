#!/usr/bin/env python3
"""
生成根 README 里「页头的前台应用」那条品牌标识动画（public/readme/desktop-marks-{light,dark}.svg）。

四段标识（Claude Code / Ghostty / Cursor / Antigravity）都从本地站点的页头真实截下来再拼成一条，
四段都会动、都逐帧截图：
  - Claude Code 是像素吉祥物的取物动画：装上 Playwright 的假时钟逐 STEP_MS 推进，精灵 SVG 内容一变就
    截一帧，抓到完整一轮姿势；帧时长不用实测值，直接取 src/lib/mascot-fetch.json 里每一步的
    原始毫秒数。
  - Ghostty 是官网那只 ASCII 幽灵：同样在假时钟下按 SVG 的 data-frame 拨到第 0 帧起逐帧截满一轮，
    帧时长取 src/lib/ghostty-frames.json 的 frameMs。
  - Cursor 和 Antigravity 演示应用名下面那行窗口标题：各按 TITLE_SCRIPTS 的剧本让标题出现、变化、
    消失。这两段不用假时钟——标题的淡入淡出由 motion 交给 Web Animations API，那条时间线假时钟
    拨不动（钟拨快 5 秒，透明度动画就真的晚 5 秒才开始）。改成真实时间：注入新标题后借 SWR 的
    revalidateOnFocus 让页面回源一次（注入不发推送事件），数据一到就连续截图 SETTLE_S，画面一变
    留一帧，帧时刻按真实经过的毫秒记；两次变化之间等多久都不进时间线。
一轮的长度等于 Ghostty 一轮（CYCLE_MS = 帧数 × 帧时长）：Claude Code 先跑完取物（RUN_DURATIONS
之和），然后停在首姿势等 Ghostty 转完；标题剧本首尾都没有标题，循环回到起点才接得上。
SVG 里四段各走各的时间线：每段去重后的帧各是一个内联 <image>（WebP 或 PNG，取小的），显示最久的
那张垫底常驻，其余只留与它不同的那块盖上去，由 CSS @keyframes 按 step-end 切换不透明度，周期都是
CYCLE_MS，循环起点对齐。帧按
device_scale_factor=2 截，SVG 的宽高取 CSS 像素（截图尺寸的一半），高分屏上不糊。
不用脚本、不引外部资源：<img> 里的 SVG 不跑脚本、不加载外部资源，CSS 动画照常跑。

前置：
  1. pnpm dev:worker 与 pnpm dev:local 已在跑（workers/core/.dev.vars 里 DEV_OVERRIDES=true）
  2. Python 3 + playwright + Pillow：pip install playwright pillow && playwright install chromium
     （装了 Google Chrome 的机器可设 PLAYWRIGHT_CHANNEL=chrome 免下载）
用法：
  python3 scripts/desktop-marks-svg.py            # 明暗各一张
  python3 scripts/desktop-marks-svg.py --theme dark
站点或 Worker 不在默认端口时用 SITE_URL / DEV_WORKER_URL 环境变量指过去（后者 dev:override 也认）。
脚本自己开总开关、注入 desktop 夹具，结束后清掉注入并把总开关恢复成原来的状态。
"""

from __future__ import annotations

import argparse
import base64
import bisect
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

try:
    from PIL import Image, ImageChops
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright
except ImportError as error:
    sys.exit(f"缺少依赖 {error.name}：pip install playwright pillow && playwright install chromium")

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public/readme"
SITE_URL = os.environ.get("SITE_URL", "http://localhost:3211/")
WORKER_URL = os.environ.get("DEV_WORKER_URL", "http://localhost:8788").rstrip("/")
BROWSER_CHANNEL = os.environ.get("PLAYWRIGHT_CHANNEL") or None

MARKS = [
    ("claude-code", "desktop-claude-code.json", "Claude Code"),
    ("ghostty", "desktop-ghostty.json", "Ghostty"),
    ("cursor", "desktop-cursor.json", "Cursor"),
    ("antigravity", "desktop-antigravity.json", "Google Antigravity"),
]
DESKTOP_PATH = "/api/status/desktop"
TITLE_SCRIPTS: dict[str, list[tuple[int, str | None]]] = {
    "cursor": [
        (1100, "telemetry.ts — lyjwpage"),
        (3600, "live-desk-card.tsx — lyjwpage"),
        (5900, None),
    ],
    "antigravity": [
        (2400, "pulse.ts — lyjwpage"),
        (4800, None),
    ],
}
PAD_X, PAD_Y = 24, 16  # 吉祥物取物会探出左边界，裁剪不能只按静态标识宽度。
GAP = 32
STEP_MS = 25  # 假时钟步长不能超过姿势序列最短帧，否则会漏帧。
SETTLE_S = 0.7
FOCUS_THROTTLE_S = 5.1

sequence = json.loads((ROOT / "src/lib/mascot-fetch.json").read_text())["sequence"]
RUN_DURATIONS = [step["ms"] for step in sequence[1:-1]]

ghostty_frames = json.loads((ROOT / "src/lib/ghostty-frames.json").read_text())
GHOSTTY_FRAME_MS: int = ghostty_frames["frameMs"]
GHOSTTY_FRAME_COUNT: int = len(ghostty_frames["frames"])
CYCLE_MS = GHOSTTY_FRAME_MS * GHOSTTY_FRAME_COUNT


@dataclass
class Timeline:

    starts: list[int]
    paths: list[Path]

    def at(self, ms: int) -> Path:
        return self.paths[bisect.bisect_right(self.starts, ms) - 1]


def override(*args: str) -> str:
    result = subprocess.run(
        ["pnpm", "--silent", "dev:override", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, "DEV_WORKER_URL": WORKER_URL},
    )
    return result.stdout


def override_enabled() -> bool:
    with urllib.request.urlopen(f"{WORKER_URL}/api/dev/overrides", timeout=10) as response:
        return bool(json.load(response).get("enabled"))


def clip_of(element) -> dict[str, float]:
    box = element.bounding_box()
    return {
        "x": box["x"] - PAD_X,
        "y": box["y"] - PAD_Y,
        "width": box["width"] + 2 * PAD_X,
        "height": box["height"] + 2 * PAD_Y,
    }


def new_page(browser, theme: str, *, clock: bool):
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 800},
        device_scale_factor=2,
        color_scheme=theme,
    )
    page = ctx.new_page()
    if clock:
        page.clock.install()
    page.goto(SITE_URL, wait_until="load", timeout=120_000)
    # 轮询与长连接可能让 networkidle 永不满足。
    try:
        page.wait_for_load_state("networkidle", timeout=10_000)
    except PlaywrightTimeoutError:
        pass
    if theme == "dark":
        page.wait_for_selector("html.dark")
    return page


def freeze_at_mark(page, sel: str, name: str):
    for _ in range(400):
        if page.query_selector(sel):
            break
        page.clock.run_for(100)
        page.wait_for_timeout(20)
    else:
        raise SystemExit(f"假时钟下没等到 {name} 标识，检查夹具是否注入、总开关是否打开")
    element = page.query_selector(sel)
    page.clock.run_for(1500)
    # Python 绑定把数字当秒；须传 datetime 并留余量，避免 pause_at 落在过去。
    now_ms = page.evaluate("Date.now()")
    page.clock.pause_at(datetime.fromtimestamp((now_ms + 1000) / 1000, tz=timezone.utc))
    return element


def capture_mascot(page, sel: str, frames_dir: Path, theme: str) -> Timeline:
    element = freeze_at_mark(page, sel, "Claude Code")
    clip = clip_of(element)

    svg = page.locator(f'{sel} svg[shape-rendering="crispEdges"]').first
    read = lambda: svg.evaluate("n => n.innerHTML")  # noqa: E731

    # 初始姿势可能在半轮中间，长停顿才是完整循环的边界。
    timeline: list[list] = []
    current = read()
    path = frames_dir / f"claude-{theme}-000.png"
    page.screenshot(path=str(path), clip=clip, scale="device")
    timeline.append([current, path, 0])
    for _ in range(16_000 // STEP_MS):
        page.clock.run_for(STEP_MS)
        timeline[-1][2] += STEP_MS
        content = read()
        if content != current:
            current = content
            path = frames_dir / f"claude-{theme}-{len(timeline):03d}.png"
            page.screenshot(path=str(path), clip=clip, scale="device")
            timeline.append([content, path, 0])

    idles = [i for i, item in enumerate(timeline) if item[2] >= 1200]
    if len(idles) < 2:
        raise SystemExit("16 秒内没录到完整一轮取物动画")
    cycle = timeline[idles[0] + 1 : idles[1] + 1]
    if len(cycle) != len(RUN_DURATIONS) + 1:
        raise SystemExit(f"录到 {len(cycle)} 帧，与 mascot-fetch.json 的 {len(RUN_DURATIONS) + 1} 帧不符")
    measured = sum(item[2] for item in cycle[:-1])
    print(f"  {theme} Claude Code: {len(cycle)} 帧，实测一轮 {measured}ms（源数据 {sum(RUN_DURATIONS)}ms）", file=sys.stderr)
    starts = [0]
    for duration in RUN_DURATIONS:
        starts.append(starts[-1] + duration)
    return Timeline(starts, [item[1] for item in cycle])


def capture_ghostty(page, sel: str, frames_dir: Path, theme: str) -> Timeline:
    element = freeze_at_mark(page, sel, "Ghostty")
    clip = clip_of(element)
    svg = page.locator(f"{sel} svg").first
    frame = lambda: int(svg.get_attribute("data-frame"))  # noqa: E731

    for _ in range(CYCLE_MS // 5 + 40):
        if frame() == 0:
            break
        page.clock.run_for(5)
    else:
        raise SystemExit("拨了一整轮也没等到 Ghostty 第 0 帧，假时钟下 rAF 是否在跑？")

    paths = []
    for index in range(GHOSTTY_FRAME_COUNT):
        if frame() != index:
            raise SystemExit(f"Ghostty 第 {index} 帧没对上，读到 {frame()}")
        path = frames_dir / f"ghostty-{theme}-{index:03d}.png"
        page.screenshot(path=str(path), clip=clip, scale="device")
        paths.append(path)
        for _ in range((GHOSTTY_FRAME_MS + 50) // 5):
            page.clock.run_for(5)
            if frame() != index:
                break
        else:
            raise SystemExit(f"Ghostty 停在第 {index} 帧不动了")
    print(f"  {theme} Ghostty: {len(paths)} 帧，每帧 {GHOSTTY_FRAME_MS}ms", file=sys.stderr)
    return Timeline([i * GHOSTTY_FRAME_MS for i in range(GHOSTTY_FRAME_COUNT)], paths)


def titled_fixture(base: str, title: str | None, path: Path) -> Path:
    fixture = json.loads((ROOT / "workers/core/dev-fixtures" / base).read_text())
    fixture["data"]["desktop"]["windowTitle"] = title
    path.write_text(json.dumps(fixture, ensure_ascii=False))
    return path


def capture_titles(browser, key: str, fixture: str, name: str, frames_dir: Path, theme: str) -> Timeline:
    sel = f'[aria-label="Using {name}"]'
    script = TITLE_SCRIPTS[key]
    variants = {
        title: titled_fixture(fixture, title, frames_dir / f"{key}-{index}.json")
        for index, title in enumerate(dict.fromkeys([None, *(title for _, title in script)]))
    }

    # 居中徽章带标题时向两侧扩张，裁剪框必须覆盖所有状态。
    x0 = y0 = float("inf")
    x1 = y1 = float("-inf")
    for title, path in variants.items():
        override(DESKTOP_PATH, str(path))
        page = new_page(browser, theme, clock=False)
        element = page.wait_for_selector(sel, timeout=30_000)
        page.wait_for_timeout(1500)
        box = clip_of(element)
        x0, y0 = min(x0, box["x"]), min(y0, box["y"])
        x1, y1 = max(x1, box["x"] + box["width"]), max(y1, box["y"] + box["height"])
        page.context.close()
    clip = {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}

    override(DESKTOP_PATH, str(variants[None]))
    page = new_page(browser, theme, clock=False)
    page.wait_for_selector(sel, timeout=30_000)
    page.wait_for_timeout(1500)
    shot = page.screenshot(clip=clip, scale="device")
    path = frames_dir / f"{key}-{theme}-000.png"
    path.write_bytes(shot)
    starts, paths = [0], [path]
    last_focus = float("-inf")
    for at_ms, title in script:
        if at_ms <= starts[-1]:
            raise SystemExit(f"{key} 剧本 {at_ms}ms 那步来得太早，上一步的过渡 {starts[-1]}ms 才收完")
        override(DESKTOP_PATH, str(variants[title]))
        hover = f"{name} · {title}" if title else name
        # 注入不发推送，须通过 focus 回源，并等待 SWR 的真实时间节流。浏览器自己发给新页面的 focus
        # 也占节流窗口，派出的这次可能被吞掉，没回源就隔一个窗口再派。
        for _ in range(3):
            page.wait_for_timeout(max(0.0, FOCUS_THROTTLE_S - (time.perf_counter() - last_focus)) * 1000)
            page.evaluate("window.dispatchEvent(new Event('focus'))")
            last_focus = time.perf_counter()
            while time.perf_counter() - last_focus < FOCUS_THROTTLE_S:
                if page.get_attribute(sel, "title") == hover:
                    break
                page.wait_for_timeout(20)
            else:
                continue
            break
        else:
            raise SystemExit(f"派了 3 次 focus 页面还没拿到「{hover}」，检查夹具是否注入、总开关是否打开")
        arrived = time.perf_counter()
        while True:
            now = time.perf_counter()
            if now - arrived > SETTLE_S:
                break
            frame = page.screenshot(clip=clip, scale="device")
            if frame != shot:
                shot = frame
                path = frames_dir / f"{key}-{theme}-{len(paths):03d}.png"
                path.write_bytes(shot)
                paths.append(path)
                starts.append(at_ms + round((now - arrived) * 1000))
    if len(paths) < len(script) + 1:
        raise SystemExit(f"{key} 只截到 {len(paths)} 帧，标题变化没画出来")
    page.context.close()
    print(f"  {theme} {name}: {len(paths)} 帧，标题剧本 {len(script)} 步", file=sys.stderr)
    return Timeline(starts, paths)


def capture(theme: str, frames_dir: Path) -> dict[str, Timeline]:
    captured: dict[str, Timeline] = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=BROWSER_CHANNEL)
        for key, fixture, name in MARKS:
            if key in TITLE_SCRIPTS:
                captured[key] = capture_titles(browser, key, fixture, name, frames_dir, theme)
                continue
            override(DESKTOP_PATH, str(titled_fixture(fixture, None, frames_dir / f"{key}-untitled.json")))
            page = new_page(browser, theme, clock=True)
            sel = f'[aria-label="Using {name}"]'
            if key == "claude-code":
                captured[key] = capture_mascot(page, sel, frames_dir, theme)
            else:
                captured[key] = capture_ghostty(page, sel, frames_dir, theme)
            page.context.close()
        browser.close()
    return captured


def encode(image: Image.Image) -> str:
    candidates = []
    for fmt, mime, options in (
        ("WEBP", "image/webp", {"quality": 90, "method": 6}),
        ("WEBP", "image/webp", {"lossless": True, "method": 6}),
        ("PNG", "image/png", {"optimize": True}),
    ):
        buffer = io.BytesIO()
        image.save(buffer, fmt, **options)
        candidates.append((len(buffer.getvalue()), mime, buffer.getvalue()))
    _, mime, data = min(candidates)
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def segment_frames(timeline: Timeline) -> tuple[list[Image.Image], list[tuple[int, int]]]:
    images: list[Image.Image] = []
    index_of: dict[str, int] = {}
    runs: list[tuple[int, int]] = []
    for start, path in zip(timeline.starts, timeline.paths):
        if start >= CYCLE_MS:
            break
        image = Image.open(path).convert("RGB")
        digest = hashlib.sha256(image.tobytes()).hexdigest()
        if digest not in index_of:
            index_of[digest] = len(images)
            images.append(image)
        index = index_of[digest]
        if not runs or runs[-1][1] != index:
            runs.append((start, index))
    return images, runs


def keyframes(name: str, runs: list[tuple[int, int]], index: int) -> str:
    pct = lambda ms: f"{ms * 100 / CYCLE_MS:.4f}".rstrip("0").rstrip(".") + "%"  # noqa: E731
    stops: list[tuple[str, int]] = []
    for position, (start, frame) in enumerate(runs):
        shown = int(frame == index)
        if position == 0 or shown != stops[-1][1]:
            stops.append((pct(start), shown))
    if stops[0][0] != "0%":
        stops.insert(0, ("0%", 0))
    stops.append(("100%", stops[-1][1]))
    body = "".join(f"{at}{{opacity:{shown}}}" for at, shown in stops)
    return f"@keyframes {name}{{{body}}}"


def compose(theme: str, captured: dict[str, Timeline]) -> Path:
    r, g, b = Image.open(captured["cursor"].paths[0]).convert("RGB").getpixel((0, 0))
    css = lambda px: f"{px / 2:g}"  # noqa: E731

    rules: list[str] = []
    layers: list[str] = []
    x = 0
    height = None
    unique = 0
    for key, _, _ in MARKS:
        images, runs = segment_frames(captured[key])
        unique += len(images)
        height = height or images[0].height
        assert all(image.size == images[0].size for image in images), key
        assert images[0].height == height, key
        # 显示最久的那张垫底常驻，其余帧只在自己的时段盖上去。
        shown_ms = [0] * len(images)
        for (start, frame), (end, _) in zip(runs, [*runs[1:], (CYCLE_MS, -1)]):
            shown_ms[frame] += end - start
        base = max(range(len(images)), key=shown_ms.__getitem__)
        order = [base, *(i for i in range(len(images)) if i != base)]
        for i in order:
            image = images[i]
            # 盖上去的帧只留与垫底帧不同的那块，静止的字标不重复内联。边界对齐到偶数设备像素
            # （整 CSS 像素），1 倍屏缩放时补丁和垫底帧的采样相位才一致、不出接缝。
            left, top, right, bottom = (
                (0, 0, image.width, image.height) if i == base
                else ImageChops.difference(images[base], image).getbbox()
            )
            left, top = left // 2 * 2, top // 2 * 2
            right, bottom = min(image.width, -(-right // 2) * 2), min(image.height, -(-bottom // 2) * 2)
            patch = image.crop((left, top, right, bottom))
            attrs = (f'x="{css(x + left)}" y="{css(top)}" '
                     f'width="{css(patch.width)}" height="{css(patch.height)}" href="{encode(patch)}"')
            if i == base:
                layers.append(f"<image {attrs}/>")
                continue
            name = f"{key.replace('-', '')}{i}"
            rules.append(keyframes(name, runs, i))
            rules.append(f"#{name}{{animation-name:{name}}}")
            layers.append(f'<image id="{name}" class="f" {attrs}/>')
        x += images[0].width + GAP + images[0].width % 2
    width = x - GAP - images[0].width % 2

    svg = "\n".join([
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{css(width)}" height="{css(height)}" '
        f'viewBox="0 0 {css(width)} {css(height)}">',
        "<style>",
        f".f{{opacity:0;animation-duration:{CYCLE_MS}ms;animation-timing-function:step-end;"
        "animation-iteration-count:infinite}",
        *rules,
        "</style>",
        f'<rect width="100%" height="100%" fill="#{r:02x}{g:02x}{b:02x}"/>',
        *layers,
        "</svg>",
        "",
    ])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"desktop-marks-{theme}.svg"
    out.write_text(svg)
    print(f"  {out.relative_to(ROOT)}：{css(width)}×{css(height)}，{unique} 张帧，"
          f"一轮 {CYCLE_MS}ms，{out.stat().st_size} 字节", file=sys.stderr)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--theme", choices=["light", "dark"], action="append", help="默认明暗都生成")
    args = parser.parse_args()
    themes = args.theme or ["light", "dark"]

    try:
        was_enabled = override_enabled()
    except OSError as error:
        sys.exit(f"连不上本地 Worker {WORKER_URL}：{error}。先起 pnpm dev:worker 与 pnpm dev:local")
    override("--on")
    try:
        with tempfile.TemporaryDirectory(prefix="desktop-marks-") as tmp:
            frames_dir = Path(tmp)
            for theme in themes:
                print(f"截取 {theme}…", file=sys.stderr)
                compose(theme, capture(theme, frames_dir))
    finally:
        override(DESKTOP_PATH, "--clear")
        if not was_enabled:
            override("--off")


if __name__ == "__main__":
    main()
