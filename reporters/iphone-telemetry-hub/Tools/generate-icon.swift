#!/usr/bin/env swift
import AppKit

/**
 画 App 图标：深底 + 两圈断开的白环 + 中心一颗绿点。

 和 MacTelemetryHub 那个图标是同族（那边是**一**圈断环加绿点），因为这两个 App 是同
 一件事的两台设备版。手机这个用两圈区分开。

 **刻意不用活动圆环那三个颜色。** 那是其中一个模块的标识，不是这个 App 的脸 ——
 用它当图标的话，加了第二个模块之后这张脸就在说谎了。绿点和站点的 `--live` 同一个
 意思：这是一路实时数据。

 用脚本画而不是塞一张 PNG 进库：这张图没有源文件可言，就是几行几何 —— 存成二进制
 反而没法改。build-install.sh 每次都会先跑一遍。

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

let output = "App/iPhoneTelemetryHub/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
do {
    try data.write(to: URL(fileURLWithPath: output))
} catch {
    // 顶层的 try 抛出来是一屏 swift-frontend 堆栈，看不出到底怎么了。
    // 这里最常见的失败就是「路径不对」，直接说出来
    FileHandle.standardError.write(Data("写不进 \(output)：\(error.localizedDescription)\n".utf8))
    exit(1)
}
print("Generated \(output)")
