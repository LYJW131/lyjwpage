#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

DERIVED_DATA="${TMPDIR:-/tmp}/lyjwpage-ios-xcode"
TEAM="${LYJWPAGE_IOS_TEAM:-2VTXNMR2GL}"
DEVICE="${LYJWPAGE_IOS_DEVICE:-}"

if [[ -z "$DEVICE" ]]; then
  DEVICE="$(xcrun devicectl list devices --json-output - 2>/dev/null | python3 -c '
import json, sys
devices = json.load(sys.stdin)["result"]["devices"]
usable = [
    d for d in devices
    if d.get("hardwareProperties", {}).get("deviceType") == "iPhone"
    and d.get("hardwareProperties", {}).get("reality") == "physical"
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
  echo "指定一台：LYJWPAGE_IOS_DEVICE=<identifier> $0" >&2
  exit 1
fi

swift Tools/generate-icon.swift
xcodegen generate

# generic/platform=iOS 可能选择不含 HealthKit 的通配描述文件，必须对具体设备自动签名。
xcodebuild \
  -project Lyjwpage.xcodeproj \
  -scheme Lyjwpage \
  -configuration Release \
  -destination "id=$DEVICE" \
  -derivedDataPath "$DERIVED_DATA" \
  "DEVELOPMENT_TEAM=$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  build

APP="$DERIVED_DATA/Build/Products/Release-iphoneos/Lyjwpage.app"

if ! xcrun devicectl device install app --device "$DEVICE" "$APP"; then
  echo >&2
  echo "包编好了（$APP），是装不进去 —— 手机要解锁、并且和这台 Mac 在同一个网络里。" >&2
  echo "手机醒着之后重跑一次就行，编译会走缓存。" >&2
  exit 1
fi

echo
echo "装好了。第一次打开要做两件事："
echo "  1. 允许读取健康数据（活动、锻炼、站立、步数、距离、爬楼层数及训练记录全都要勾）"
echo "  2. 「iPhone」页右上角齿轮里手填上报地址 https://ingest.homepage.lyjw.llc/api/ingest/iphone"
echo "     和 lyjwpage-iphone 那把 service token 的 Client ID / Secret，保存后按一次「Report Now」"
echo "  手机上装着同一 bundle id 的版本时是覆盖安装，授权和密钥都还在，这两步可以跳过。"
