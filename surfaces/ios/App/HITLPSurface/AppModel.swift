import SwiftUI
import UIKit
import HITLPSurfaceKit

/// The app's state: the configured servers, the one in use, its tasks, and
/// the `/events` stream that keeps them current while the list is on screen.
@MainActor @Observable
final class AppModel {
    static let shared = AppModel()

    /// Two entries: the cluster instance and the laptop instance. Empty until set in Settings.
    var servers: [ServerConfig]
    var active: ServerConfig?
    var tasks: [TaskView] = []
    var loading = false
    var error: String?
    var pushError: String?
    /// A task id to open, from a tapped notification.
    var openTaskId: String?

    private var apnsToken: String?
    private var eventsTask: Task<Void, Never>?

    init() {
        var stored = Keychain.loadServers()
        while stored.count < 2 {
            stored.append(ServerConfig(id: UUID().uuidString, name: stored.isEmpty ? "Cluster" : "Laptop", baseURL: "", credential: ""))
        }
        servers = Array(stored.prefix(2))
    }

    var isConfigured: Bool { servers.contains(where: \.isConfigured) }

    var client: SurfaceClient? { active.map { SurfaceClient(server: $0) } }

    func saveServers(_ new: [ServerConfig]) async {
        servers = new
        Keychain.saveServers(new)
        active = nil
        await refresh()
        if let token = apnsToken { await registerDevice(token: token) }
    }

    /// Tries each configured server in order; the first answering `GET /tasks` with 200 is used.
    func refresh() async {
        loading = true
        defer { loading = false }
        // Prefer the server in use; fall back to the configured order.
        let order = active.map { a in [a] + servers.filter { $0.id != a.id } } ?? servers
        switch await ServerPicker.pick(order) {
        case .success(let pick):
            if active?.id != pick.server.id { stopEvents() }
            active = pick.server
            tasks = pick.tasks.newestFirst()
            error = nil
        case .failure(let e):
            active = nil
            error = isConfigured ? e.localizedDescription : nil
        }
    }

    func upsert(_ task: TaskView) { tasks = tasks.upserting(task) }

    /// Holds `GET /events` open while the list is on screen, inserting each
    /// task event; reconnects after a drop, backing off up to 30 s.
    func startEvents() {
        guard eventsTask == nil else { return }
        eventsTask = Task { [weak self] in
            var delay: UInt64 = 1
            while !Task.isCancelled {
                guard let self else { return }
                if self.active == nil { await self.refresh() }
                if let client = self.client {
                    do {
                        for try await task in client.events() {
                            delay = 1
                            self.upsert(task)
                        }
                    } catch {}
                    // The stream dropped: pick up what was missed before reconnecting.
                    if !Task.isCancelled { await self.refresh() }
                }
                try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
                delay = min(delay * 2, 30)
            }
        }
    }

    func stopEvents() {
        eventsTask?.cancel()
        eventsTask = nil
    }

    /// Puts this device on every configured server, with the APNs environment this build uses.
    func registerDevice(token: String) async {
        apnsToken = token
        let device = Device(token: token, environment: Self.apnsEnvironment, name: UIDevice.current.name)
        var failures: [String] = []
        for server in servers where server.isConfigured {
            do { try await SurfaceClient(server: server).register(deviceId: Self.deviceId, device) }
            catch { failures.append("\(server.name): \(error.localizedDescription)") }
        }
        pushError = failures.isEmpty ? nil : failures.joined(separator: "\n")
    }

    func open(taskId: String) { openTaskId = taskId }

    /// A development build (Debug, run from Xcode) gets sandbox tokens; Release gets production.
    static var apnsEnvironment: Device.Environment {
        #if DEBUG
        .sandbox
        #else
        .production
        #endif
    }

    /// A stable id for this install, the `{deviceId}` of `PUT /devices/{deviceId}`.
    static var deviceId: String {
        UIDevice.current.identifierForVendor?.uuidString ?? "unknown-device"
    }
}
