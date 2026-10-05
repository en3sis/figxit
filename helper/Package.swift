// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "figxit-helper",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0")
    ],
    targets: [
        .executableTarget(
            name: "figxit-helper",
            dependencies: [.product(name: "Sparkle", package: "Sparkle")],
            path: "Sources/figxit-helper",
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks"]),
                .unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@loader_path"]),
            ]
        )
    ]
)
