import XCTest
@testable import HITLPSurfaceKit

final class PushPayloadTests: XCTestCase {
    func testAlertCarriesTheTaskId() {
        let alert: [AnyHashable: Any] = ["aps": ["alert": ["title": "Question"]], "taskId": "t1"]
        XCTAssertEqual(PushPayload.taskId(from: alert), "t1")
        XCTAssertNil(PushPayload.closedTaskId(from: alert))
    }

    func testClosedPushNamesTheTask() {
        let closed: [AnyHashable: Any] = ["aps": ["content-available": 1], "taskId": "t1", "event": "closed"]
        XCTAssertEqual(PushPayload.closedTaskId(from: closed), "t1")
        XCTAssertNil(PushPayload.closedTaskId(from: ["event": "closed", "taskId": ""]))
    }
}
