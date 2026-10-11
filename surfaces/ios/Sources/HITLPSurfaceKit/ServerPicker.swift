import Foundation

/// Picks the server to use: each configured one in order, the first whose
/// `GET /tasks` answers 200 wins. When both answer, the first configured one
/// (the cluster instance, entered first) is used.
public enum ServerPicker {
    public struct Pick: Sendable {
        public var server: ServerConfig
        public var tasks: [TaskView]
    }

    public static func pick(
        _ servers: [ServerConfig],
        tasks: (ServerConfig) async throws -> [TaskView]
    ) async -> Result<Pick, SurfaceError> {
        var last: SurfaceError = .transport("no server is configured")
        for server in servers where server.isConfigured {
            do { return .success(Pick(server: server, tasks: try await tasks(server))) }
            catch let e as SurfaceError { last = e }
            catch { last = .transport(error.localizedDescription) }
        }
        return .failure(last)
    }

    public static func pick(_ servers: [ServerConfig], session: URLSession = .shared) async -> Result<Pick, SurfaceError> {
        await pick(servers) { try await SurfaceClient(server: $0, session: session).tasks() }
    }
}
