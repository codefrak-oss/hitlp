import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// One server a surface talks to: a name, a base URL ending `/surface/v1`, and its credential.
public struct ServerConfig: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var baseURL: String
    public var credential: String

    public init(id: String, name: String, baseURL: String, credential: String) {
        self.id = id; self.name = name; self.baseURL = baseURL; self.credential = credential
    }

    public var isConfigured: Bool {
        !baseURL.trimmingCharacters(in: .whitespaces).isEmpty && !credential.isEmpty
    }
}

/// The surface API client (spec 7.8): the six routes, a Bearer credential on each.
public struct SurfaceClient: Sendable {
    public let server: ServerConfig
    let session: URLSession

    public init(server: ServerConfig, session: URLSession = .shared) {
        self.server = server
        self.session = session
    }

    /// `GET /tasks`: open tasks routed to the human and those decided recently, newest first.
    public func tasks() async throws -> [TaskView] {
        let data = try await send(request("GET", "tasks"), expect: 200)
        do { return try TaskList.decode(data).tasks } catch { throw SurfaceError.malformed("\(error)") }
    }

    /// `GET /tasks/{id}`.
    public func task(id: String) async throws -> TaskView {
        let data = try await send(request("GET", "tasks/\(escape(id))"), expect: 200)
        do { return try TaskView.decode(data) } catch { throw SurfaceError.malformed("\(error)") }
    }

    /// `POST /tasks/{id}/decision`; answers the decision record.
    @discardableResult
    public func decide(taskId: String, _ decision: Decision) async throws -> DecisionRecord {
        var req = try request("POST", "tasks/\(escape(taskId))/decision")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(decision)
        let data = try await send(req, expect: 200)
        do { return try JSONDecoder().decode(DecisionRecord.self, from: data) } catch { throw SurfaceError.malformed("\(error)") }
    }

    /// `PUT /devices/{deviceId}`; answers the device as stored.
    @discardableResult
    public func register(deviceId: String, _ device: Device) async throws -> Device {
        var req = try request("PUT", "devices/\(escape(deviceId))")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(device.registration)
        let data = try await send(req, expect: 200)
        do { return try JSONDecoder().decode(Device.self, from: data) } catch { throw SurfaceError.malformed("\(error)") }
    }

    /// `DELETE /devices/{deviceId}`.
    public func unregister(deviceId: String) async throws {
        _ = try await send(request("DELETE", "devices/\(escape(deviceId))"), expect: 204)
    }

    /// The `GET /events` request, for a caller that streams it (see `events()`).
    public func eventsRequest() throws -> URLRequest {
        var req = try request("GET", "events")
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 24 * 3600
        return req
    }

    #if !canImport(FoundationNetworking)
    /// `GET /events`: the task view of each `task` event, until the stream ends.
    public func events() -> AsyncThrowingStream<TaskView, Error> {
        AsyncThrowingStream { continuation in
            let work = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: try eventsRequest())
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard status == 200 else { throw SurfaceError.from(status: status, body: Data()) }
                    var parser = SSEParser()
                    // `lines` drops empty lines, which end a record; feed one after each data line instead.
                    var buffer = Data()
                    for try await byte in bytes {
                        if byte == 0x0A {
                            let line = String(decoding: buffer, as: UTF8.self)
                            buffer.removeAll(keepingCapacity: true)
                            if let task = parser.feed(line: line).flatMap(SSEParser.task(from:)) {
                                continuation.yield(task)
                            }
                        } else {
                            buffer.append(byte)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in work.cancel() }
        }
    }
    #endif

    func request(_ method: String, _ path: String) throws -> URLRequest {
        var base = server.baseURL.trimmingCharacters(in: .whitespaces)
        while base.hasSuffix("/") { base.removeLast() }
        guard base.hasSuffix("/surface/v1"), let url = URL(string: "\(base)/\(path)") else {
            throw SurfaceError.transport("the base URL must end in /surface/v1")
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(server.credential)", forHTTPHeaderField: "Authorization")
        return req
    }

    func send(_ req: URLRequest, expect: Int) async throws -> Data {
        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: req) }
        catch { throw SurfaceError.transport(error.localizedDescription) }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == expect else { throw SurfaceError.from(status: status, body: data) }
        return data
    }

    private func escape(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? s
    }
}
