import XCTest
@testable import HITLPSurfaceKit

final class SSEParserTests: XCTestCase {
    func testOneTaskRecordAndAKeepAlive() throws {
        let view = String(decoding: try JSONSerialization.data(withJSONObject: Examples.object(Examples.data("task.json"))), as: UTF8.self)
        let stream = ": keep-alive\n\nevent: task\nid: task-7f3a\ndata: \(view)\n\n: keep-alive\n\n"
        let tasks = SSEParser.tasks(in: stream)
        XCTAssertEqual(tasks.count, 1)
        XCTAssertEqual(tasks.first?.id, "task-7f3a")
        XCTAssertEqual(tasks.first?.attested?.source, "server")
    }

    func testOtherEventsYieldNothing() {
        XCTAssertTrue(SSEParser.tasks(in: "event: ping\ndata: {}\n\n").isEmpty)
    }

    func testRecordFields() {
        var p = SSEParser()
        XCTAssertNil(p.feed(line: "event: task"))
        XCTAssertNil(p.feed(line: "id: t1\r"))
        XCTAssertNil(p.feed(line: "data: {}"))
        XCTAssertEqual(p.feed(line: ""), SSEParser.Event(event: "task", id: "t1", data: "{}"))
        XCTAssertNil(p.feed(line: ""))
    }
}
