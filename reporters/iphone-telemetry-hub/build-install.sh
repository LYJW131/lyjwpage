#!/usr/bin/env bash
# 生成工程 → 编译 Release → 装到 iPhone 上。照着 MacTelemetryHub 的 build-release.sh 写的。
set -euo pipefail

cd "$(dirname "$0")"

DERIVED_DATA="${TMPDIR:-/tmp}/iphone-telemetry-hub-xcode"
TEAM="${IPHONE_HUB_TEAM:-2VTXNMR2GL}"
DEVICE="${IPHONE_HUB_DEVICE:-}"

# 没指定就自己挑：配对过、且这会儿不是 unavailable 的那台 iPhone。
# 挑出好几台时不猜，让人自己填 —— 装错手机比装不上更烦
if [[ -z "$DEVICE" ]]; then
  DEVICE="$(xcrun devicectl list devices --json-output - 2>/dev/null | python3 -c '
import json, sys
devices = json.load(sys.stdin)["result"]["devices"]
usable = [
    d for d in devices
    if d.get("hardwareProperties", {}).get("deviceType") == "iPhone"
    and d.get("connectionProperties", {}).get("tunnelState") != "unavailable"
]
if len(usable) == 1:
    print(usable[0]["identifier"])
elif not usable:
    print("一台可用的 iPhone 都没有 —— 手机要解锁、并且和这台 Mac 在同一个网络里。", file=sys.stderr)
else:
    print("有好几台配对着的 iPhone，不替你猜：", file=sys.stderr)
    for d in usable:
        print(" ", d["deviceProperties"]["name"], d["identifier"], file=sys.stderr)
')"
fi

if [[ -z "$DEVICE" ]]; then
  # 上面那段已经把「一台都没有」和「好几台」分开说了，这里只补怎么手动指定
  echo "指定一台：IPHONE_HUB_DEVICE=<identifier> $0" >&2
  exit 1
fi

# 图标是画出来的，不是存在库里的，每次重画一遍
swift Tools/generate-icon.swift
xcodegen generate

# **必须对着具体设备编**，手机得解锁、和这台 Mac 在同一个网络里。
#
# 试过 `generic/platform=iOS`（那样编译就不需要手机在场了），不行：自动签名那时
# 挑的是通配的那份「iOS Team Provisioning Profile: *」，而通配文件里没有 HealthKit
# 能力，直接报「doesn't include the HealthKit capability」。带特殊能力的包只有对着
# 一台具体设备才会去申请 / 更新出带那项能力的描述文件。
xcodebuild \
  -project iPhoneTelemetryHub.xcodeproj \
  -scheme iPhoneTelemetryHub \
  -configuration Release \
  -destination "id=$DEVICE" \
  -derivedDataPath "$DERIVED_DATA" \
  "DEVELOPMENT_TEAM=$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  build

APP="$DERIVED_DATA/Build/Products/Release-iphoneos/iPhoneTelemetryHub.app"

if ! xcrun devicectl device install app --device "$DEVICE" "$APP"; then
  echo >&2
  echo "包编好了（$APP），是装不进去 —— 手机要解锁、并且和这台 Mac 在同一个网络里。" >&2
  echo "手机醒着之后重跑一次就行，编译会走缓存。" >&2
  exit 1
fi

echo
echo "装好了。第一次打开要做两件事："
echo "  1. 允许读取健康数据（活动、锻炼、站立、步数、距离、爬楼层数全都要勾）"
echo "  2. 右上角齿轮里填上报地址和 TELEMETRY_INGEST_SECRET，保存后按一次「立刻上报」"
