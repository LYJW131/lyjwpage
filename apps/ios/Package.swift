// swift-tools-version: 6.0
// 只为「不开 Xcode 也能验」存在：`swift test` 编 Core/（站点模型、取数与推送，不碰任何 UI 框架）
// 并跑 Tests/，Linux 工具链上也能跑。App 和小组件由 project.yml 生成的工程编。
import PackageDescription

let package = Package(
    name: "LyjwpageCore",
    platforms: [.macOS(.v15), .iOS(.v18)],
    targets: [
        .target(name: "LyjwpageCore", path: "Core"),
        .testTarget(
            name: "LyjwpageCoreTests",
            dependencies: ["LyjwpageCore"],
            path: "Tests",
            exclude: ["Fixtures"]
        ),
    ]
)
