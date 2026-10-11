import XCTest
@testable import HITLPSurfaceKit
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Answers every request from `StubProtocol.handler` and records it.
final class StubProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, Data))?
    static var requests: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var req = request
        if req.httpBody == nil, let stream = req.httpBodyStream {
            stream.open()
            var data = Data()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buf, maxLength: buf.count); if n <= 0 { break }; data.append(buf, count: n) }
            stream.close()
            req.httpBody = data
        }
        Self.requests.append(req)
        let (status, body) = Self.handler?(req) ?? (500, Data())
        let response = HTTPURLResponse(url: req.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class ClientTests: XCTestCase {
    var session: URLSession!
    let server = ServerConfig(id: "a", name: "Cluster", baseURL: "https://hitlp.example/surface/v1/", credential: "cred-1")

    override func setUp() {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        session = URLSession(configuration: config)
        StubProtocol.requests = []
    }

    func testRoutesMethodsAndBearer() async throws {
        let task = try Examples.data("task.json")
        let record = Data(#"{"requestId":"task-7f3a","outcome":"approved","decidedBy":{"type":"human","id":"h","roles":[]},"decidedAt":"2026-10-08T18:10:00Z"}"#.utf8)
        StubProtocol.handler = { req in
            switch (req.httpMethod!, req.url!.path) {
            case ("GET", "/surface/v1/tasks"): return (200, try! Examples.data("task-list.json"))
            case ("GET", "/surface/v1/tasks/task-7f3a"): return (200, task)
            case ("POST", "/surface/v1/tasks/task-7f3a/decision"): return (200, record)
            case ("PUT", "/surface/v1/devices/dev-1"): return (200, try! Examples.data("device.json"))
            case ("DELETE", "/surface/v1/devices/dev-1"): return (204, Data())
            default: return (418, Data())
            }
        }
        let client = SurfaceClient(server: server, session: session)
        _ = try await client.tasks()
        _ = try await client.task(id: "task-7f3a")
        _ = try await client.decide(taskId: "task-7f3a", .approve(reason: nil, payloadDigest: "sha256:9f2c1e0a"))
        _ = try await client.register(deviceId: "dev-1", Device(token: "t", environment: .sandbox, name: "P"))
        try await client.unregister(deviceId: "dev-1")
        let events = try client.eventsRequest()

        let all = StubProtocol.requests + [events]
        XCTAssertEqual(all.map { "\($0.httpMethod!) \($0.url!.path)" }, [
            "GET /surface/v1/tasks",
            "GET /surface/v1/tasks/task-7f3a",
            "POST /surface/v1/tasks/task-7f3a/decision",
            "PUT /surface/v1/devices/dev-1",
            "DELETE /surface/v1/devices/dev-1",
            "GET /surface/v1/events",
        ])
        for req in all { XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer cred-1") }
        let body = try Examples.object(StubProtocol.requests[2].httpBody!)
        XCTAssertEqual(body, ["outcome": "approve", "payloadDigest": "sha256:9f2c1e0a"])
    }

    func testBaseURLMustEndInSurfaceV1() {
        let client = SurfaceClient(server: ServerConfig(id: "x", name: "x", baseURL: "https://hitlp.example/", credential: "c"), session: session)
        XCTAssertThrowsError(try client.request("GET", "tasks"))
    }

    func testErrorMapping() async throws {
        let client = SurfaceClient(server: server, session: session)
        let cases: [(Int, SurfaceError)] = [
            (400, .badRequest("answer must be a string")),
            (401, .credentialRefused),
            (404, .taskUnknown),
            (409, .conflict("answer must be a string")),
        ]
        var words = Set<String>()
        for (status, expected) in cases {
            StubProtocol.handler = { _ in (status, Data(#"{"error":"answer must be a string"}"#.utf8)) }
            do {
                _ = try await client.decide(taskId: "t", .answer(.number(1), reason: nil))
                XCTFail("\(status) did not throw")
            } catch let e as SurfaceError {
                XCTAssertEqual(e, expected)
                words.insert(e.errorDescription!)
            }
        }
        XCTAssertEqual(words.count, 4)
        XCTAssertTrue(SurfaceError.badRequest("answer must be a string").errorDescription!.contains("answer must be a string"))
    }

    func testCleartextBaseURLIsRefused() {
        let client = SurfaceClient(server: ServerConfig(id: "x", name: "x", baseURL: "http://mac.local:8080/surface/v1", credential: "c"), session: session)
        XCTAssertThrowsError(try client.request("GET", "tasks")) { e in
            XCTAssertEqual(e as? SurfaceError, .transport("the base URL must use https"))
        }
    }

    func testPickerTakesTheFirstServerThatAnswers() async {
        let laptop = ServerConfig(id: "b", name: "Laptop", baseURL: "https://mac.local:8443/surface/v1", credential: "cred-2")
        let empty = ServerConfig(id: "c", name: "", baseURL: "", credential: "")
        StubProtocol.handler = { req in
            req.url!.host == "hitlp.example" ? (401, Data(#"{"error":"no"}"#.utf8)) : (200, Data(#"{"tasks":[]}"#.utf8))
        }
        let pick = try? await ServerPicker.pick([empty, server, laptop], session: session).get()
        XCTAssertEqual(pick?.server.id, "b")

        StubProtocol.handler = { _ in (200, Data(#"{"tasks":[]}"#.utf8)) }
        let both = try? await ServerPicker.pick([server, laptop], session: session).get()
        XCTAssertEqual(both?.server.id, "a")

        StubProtocol.handler = { _ in (401, Data()) }
        let none = await ServerPicker.pick([server, laptop], session: session)
        if case .failure(let e) = none { XCTAssertEqual(e, .credentialRefused) } else { XCTFail() }
    }

    func testPushPayloadCarriesOnlyTheTaskId() {
        let info: [AnyHashable: Any] = ["aps": ["alert": ["title": "Approval requested", "body": "task-7f3a"]], "taskId": "task-7f3a"]
        XCTAssertEqual(PushPayload.taskId(from: info), "task-7f3a")
        XCTAssertNil(PushPayload.taskId(from: ["aps": [:]]))
    }
}
