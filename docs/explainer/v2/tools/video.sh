#!/bin/bash
set -euo pipefail

if [ $# -lt 2 ] || [ "$1" = "--help" ]; then
  cat <<'EOF'
用法：docs/explainer/v2/tools/video.sh <帧目录> <输出.mp4> [配乐.mp3]

把 frames.mjs 渲好的整片（24 帧每秒、一帧不缺）合成 H.264 录像，给了配乐就混进去；画质用环境变量 CRF 调，默认 27。
配乐比画面长一截（片尾余音），最后一帧按多出的时长定格。配乐取线上那份（SITE 是站点地址，比如生产域名）：
  curl -o score.mp3 "$SITE/img/$(node scripts/explainer-score.mjs)"
线上还没有这份（乐谱刚改、还没合进 main）就本地渲：node docs/explainer/v2/tools/score-mp3.mjs，写到 docs/explainer/v2/score.mp3。
EOF
  [ "${1:-}" = "--help" ] && exit 0
  exit 2
fi

src=$1 out=$2 audio=${3:-}
# ffmpeg 按编号读到第一个缺口就停，只数张数会放过「中间缺一帧、末尾多一帧」：逐个编号核对。
n=$(python3 - "$src" <<'PY'
import json, math, os, sys
d = sys.argv[1]
f = json.load(open(os.path.join(d, "film.json")))
want = math.ceil(f["duration"] * f["fps"])
have = sorted(int(n[:5]) for n in os.listdir(d) if len(n) == 9 and n.endswith(".jpg") and n[:5].isdigit())
if have != list(range(want)):
    gap = next((i for i in range(want) if i >= len(have) or have[i] != i), want)
    sys.exit(f"帧不齐：{d} 里有 {len(have)} 帧，整片是 00000–{want - 1:05d}，第一处对不上在 {gap:05d}；用 frames.mjs 不带 --every 渲整片")
print(want)
PY
)

args=(-v error -y -framerate 24 -i "$src/%05d.jpg")
if [ -n "$audio" ]; then
  hold=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$audio" | python3 -c "import sys; print(round(max(0.0, float(sys.stdin.read()) - $n / 24) + 0.1, 3))")
  args+=(-i "$audio" -vf "tpad=stop_mode=clone:stop_duration=$hold" -c:a aac -b:a 160k -shortest)
fi
ffmpeg "${args[@]}" -c:v libx264 -preset medium -crf "${CRF:-27}" -pix_fmt yuv420p -movflags +faststart "$out"
ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$out"
