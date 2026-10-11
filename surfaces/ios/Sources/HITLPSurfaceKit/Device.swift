import Foundation

/// A device for push: the body of `PUT /devices/{deviceId}` and the server's
/// answer to it (schemas/surface/device.schema.json).
public struct Device: Codable, Equatable, Sendable {
    public enum Environment: String, Codable, Sendable { case production, sandbox }

    public var platform: String
    public var token: String
    public var environment: Environment?
    public var name: String?
    // Filled by the server in its answer; never sent.
    public var id: String?
    public var surfaceId: String?
    public var human: String?
    public var updatedAt: String?

    public init(platform: String = "apns", token: String, environment: Environment?, name: String?) {
        self.platform = platform
        self.token = token
        self.environment = environment
        self.name = name
    }

    /// The registration body: only the fields a surface sends.
    var registration: Device {
        Device(platform: platform, token: token, environment: environment, name: name)
    }
}
