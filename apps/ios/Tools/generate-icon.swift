#!/usr/bin/env swift
import AppKit

let size = 1024
let center = CGPoint(x: size / 2, y: size / 2)

guard let context = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else { exit(1) }

context.setFillColor(NSColor(srgbRed: 0.07, green: 0.075, blue: 0.085, alpha: 1).cgColor)
context.fill(CGRect(x: 0, y: 0, width: size, height: size))

let ink = NSColor(srgbRed: 0.91, green: 0.92, blue: 0.94, alpha: 1)

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
brokenRing(radius: 246, width: 68, gap: 0.62, turn: .pi + 0.15)

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
    FileHandle.standardError.write(Data("写不进 \(output)：\(error.localizedDescription)\n".utf8))
    exit(1)
}
print("Generated \(output)")
