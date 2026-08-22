// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Kami",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "KamiCore", targets: ["KamiCore"]),
    ],
    targets: [
        .target(name: "KamiCore", path: "Sources/KamiCore"),
        .testTarget(
            name: "KamiCoreTests",
            dependencies: ["KamiCore"],
            path: "Tests/KamiCoreTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
