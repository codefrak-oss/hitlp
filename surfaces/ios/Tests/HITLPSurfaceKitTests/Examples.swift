import Foundation

/// The spec's examples, read from the repo (spec/examples/surface/), so the
/// tests check the package against the files the spec ships, not copies.
enum Examples {
    static let directory = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // HITLPSurfaceKitTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // surfaces/ios
        .deletingLastPathComponent() // surfaces
        .deletingLastPathComponent() // repo
        .appendingPathComponent("spec/examples/surface")

    static func data(_ name: String) throws -> Data {
        try Data(contentsOf: directory.appendingPathComponent(name))
    }

    static func object(_ data: Data) throws -> NSDictionary {
        try JSONSerialization.jsonObject(with: data) as! NSDictionary
    }
}
