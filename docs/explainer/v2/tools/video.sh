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
want=$(python3 -c 'import json, math, sys; f = json.load(open(sys.argv[1])); print(math.ceil(f["duration"] * f["fps"]))' "$src/film.json")
n=$(find "$src" -maxdepth 1 -name '[0-9][0-9][0-9][0-9][0-9].jpg' | wc -l)
if [ "$n" -ne "$want" ]; then
  echo "帧不齐：$src 里有 $n 帧，整片是 $want 帧；用 frames.mjs 不带 --every 渲整片" >&2
  exit 1
fi

args=(-v error -y -framerate 24 -i "$src/%05d.jpg")
if [ -n "$audio" ]; then
  hold=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$audio" | python3 -c "import sys; print(round(max(0.0, float(sys.stdin.read()) - $n / 24) + 0.1, 3))")
  args+=(-i "$audio" -vf "tpad=stop_mode=clone:stop_duration=$hold" -c:a aac -b:a 160k -shortest)
fi
ffmpeg "${args[@]}" -c:v libx264 -preset medium -crf "${CRF:-27}" -pix_fmt yuv420p -movflags +faststart "$out"
ffprobe -v error -show_entries format=duration,size -of csv=p=0 "$out"
