// swift-tools-version: 6.0
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
