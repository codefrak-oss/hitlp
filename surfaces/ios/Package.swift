// swift-tools-version:5.9
// HITLPSurfaceKit: the surface API client (spec/hitlp.md 7.8). Foundation only,
// so `swift test` runs on macOS and on Linux Swift alike; the SwiftUI app in
// App/ depends on it as a local package.
import PackageDescription

let package = Package(
    name: "HITLPSurfaceKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "HITLPSurfaceKit", targets: ["HITLPSurfaceKit"]),
    ],
    targets: [
        .target(name: "HITLPSurfaceKit"),
        .testTarget(name: "HITLPSurfaceKitTests", dependencies: ["HITLPSurfaceKit"]),
    ]
)
