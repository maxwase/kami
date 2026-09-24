// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.1"),
        .package(name: "CapacitorBrowser", path: "../../../node_modules/.pnpm/@capacitor+browser@8.0.4_@capacitor+core@8.5.1/node_modules/@capacitor/browser"),
        .package(name: "MaxwaseCapacitorHinge", path: "../../../node_modules/.pnpm/@maxwase+capacitor-hinge@git+ssh+++git@github.com+maxwase+capacitor-hinge.git+63fbb4469_7ef46953d05a25491468845c537f287d/node_modules/@maxwase/capacitor-hinge")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "MaxwaseCapacitorHinge", package: "MaxwaseCapacitorHinge")
            ]
        )
    ]
)
