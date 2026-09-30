#!/usr/bin/env swift
import AppKit

/**
 画 App 图标：深底 + 两圈断开的白环 + 中心一颗绿点。

 和 MacTelemetryHub 那个图标是同族（那边是**一**圈断环加绿点）：这个 App 起家就是那个上报器的
 手机版，现在它还是整个站点的原生客户端，两圈区分开。

 **刻意不用活动圆环那三个颜色。** 那是其中一个模块的标识，不是这个 App 的脸。绿点和站点的
 `--live` 同一个意思：这是一路实时数据 —— 整个站点讲的正是这件事。

 图标以这个脚本为源：这张图就是几行几何，二进制 PNG 没法改。`AppIcon.png` 是它的
 产物，改图标改这里、别手改 PNG。build-install.sh 每次都会先跑一遍。

 iOS 的图标要**满幅方图**，圆角由系统裁，所以这里不自己画圆角。
 */
let size = 1024
let center = CGPoint(x: size / 2, y: size / 2)

guard let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else { exit(1) }

// 底色：近黑但不是纯黑，和 Mac 那个一样留一点层次
context.setFillColor(NSColor(srgbRed: 0.07, green: 0.075, blue: 0.085, alpha: 1).cgColor)
context.fill(CGRect(x: 0, y: 0, width: size, height: size))

let ink = NSColor(srgbRed: 0.91, green: 0.92, blue: 0.94, alpha: 1)

/// 一圈断环：两段等长的弧，中间留两个缺口。`turn` 是整圈的旋转量
func brokenRing(radius: CGFloat, width: CGFloat, gap: CGFloat, turn: CGFloat) {
    context.setStrokeColor(ink.cgColor)
    context.setLineWidth(width)
    context.setLineCap(.butt)

    let sweep = CGFloat.pi - gap
    for half in 0..<2 {
        let start = turn + CGFloat(half) * .pi + gap / 2
        context.addArc(
            center: center, radius: radius,
            startAngle: start, endAngle: start + sweep, clockwise: false
        )
        context.strokePath()
    }
}

brokenRing(radius: 378, width: 76, gap: 0.62, turn: .pi / 2 + 0.3)
// 内圈的缺口转开，两圈的断口不重叠 —— 叠在一起看着像一条裂缝，不像两圈
brokenRing(radius: 246, width: 68, gap: 0.62, turn: .pi + 0.15)

// 中心那颗绿点：和站点的 --live 一个意思 —— 这是一路实时数据
context.setFillColor(NSColor(srgbRed: 0.19, green: 0.78, blue: 0.36, alpha: 1).cgColor)
context.fillEllipse(in: CGRect(
    x: center.x - 108, y: center.y - 108, width: 216, height: 216
))

guard let image = context.makeImage() else { exit(1) }
let rep = NSBitmapImageRep(cgImage: image)
guard let data = rep.representation(using: .png, properties: [:]) else { exit(1) }

let output = "App/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
do {
    try data.write(to: URL(fileURLWithPath: output))
} catch {
    // 顶层的 try 抛出来是一屏 swift-frontend 堆栈，看不出到底怎么了。
    // 这里最常见的失败就是「路径不对」，直接说出来
    FileHandle.standardError.write(Data("写不进 \(output)：\(error.localizedDescription)\n".utf8))
    exit(1)
}
print("Generated \(output)")
