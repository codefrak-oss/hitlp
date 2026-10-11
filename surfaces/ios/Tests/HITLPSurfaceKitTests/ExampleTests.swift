import XCTest
@testable import HITLPSurfaceKit

/// One test per file in spec/examples/surface/, and the encodings checked
/// against what decide.request.schema.json and device.schema.json allow.
final class ExampleTests: XCTestCase {
    func testTaskExample() throws {
        let task = try TaskView.decode(Examples.data("task.json"))
        XCTAssertEqual(task.id, "task-7f3a")
        XCTAssertEqual(task.primitive, .approve)
        XCTAssertEqual(task.status, .working)
        XCTAssertFalse(task.requiresHuman)
        XCTAssertEqual(task.attested?.source, "server")
        XCTAssertEqual(task.attested?.requester, "release-orchestrator")
        XCTAssertEqual(task.asserted?.source, "requester")
        XCTAssertEqual(task.asserted?.recommendation?.verdict, .allow)
        XCTAssertEqual(task.asserted?.recommendation?.confidence, 0.92)
        XCTAssertEqual(task.asserted?.recommendation?.by?.judge, "release-judge")
        XCTAssertEqual(task.asserted?.recommendation?.reasons, ["all checks green"])
        XCTAssertEqual(task.asserted?.lineage?.map(\.kind), ["run", "ticket"])
        XCTAssertEqual(task.payloadDigest, "sha256:9f2c1e0a")
        XCTAssertEqual(task.requires?.roles, ["approver.production-deploy"])
        XCTAssertEqual(task.payload, .object(["service": .string("api"), "image": .string("api:4821")]))
        XCTAssertEqual(task.teach?.options.map(\.id), ["always-allow", "never-allow"])
        XCTAssertEqual(task.teachOptions(after: .approve).map(\.id), ["always-allow"])
        XCTAssertEqual(task.teachOptions(after: .reject).map(\.id), ["never-allow"])
        XCTAssertEqual(task.teachOptions(after: .approve).first?.editable?.default, "deploy release * to production")
    }

    /// Spec 5.5: a task without teach options has no teach step.
    func testNoTeachOptionsMeansNoTeachStep() throws {
        let list = try TaskList.decode(Examples.data("task-list.json"))
        for task in list.tasks where task.teach == nil {
            XCTAssertTrue(task.teachOptions(after: .approve).isEmpty)
            XCTAssertTrue(task.teachOptions(after: .reject).isEmpty)
        }
    }

    func testTaskPayloadTextIsExactlyAsReceived() throws {
        let task = try TaskView.decode(Examples.data("task.json"))
        XCTAssertEqual(task.payloadText, """
        {
            "service": "api",
            "image": "api:4821"
          }
        """)
        let compact = #"{"id":"t","primitive":"approve","status":"working","createdAt":"2026-10-08T18:00:02Z","deadline":"2026-10-08T19:00:00Z","requiresHuman":false,"action":"a","payload":{"z":1.50,"a":[1,"}"]},"payloadDigest":"d"}"#
        XCTAssertEqual(try TaskView.decode(Data(compact.utf8)).payloadText, #"{"z":1.50,"a":[1,"}"]}"#)
    }

    func testTaskListExample() throws {
        let list = try TaskList.decode(Examples.data("task-list.json"))
        XCTAssertEqual(list.tasks.map(\.id), ["task-7f3a", "task-81b0"])
        let ask = list.tasks[1]
        XCTAssertEqual(ask.primitive, .ask)
        XCTAssertEqual(ask.status, .completed)
        XCTAssertTrue(ask.requiresHuman)
        XCTAssertEqual(ask.question, "Which currency?")
        XCTAssertEqual(ask.responseSchema, .object(["type": .string("string")]))
        XCTAssertNil(ask.asserted)
        XCTAssertEqual(ask.result?.outcome, "answered")
        XCTAssertEqual(ask.result?.answer, .string("EUR"))
        XCTAssertEqual(ask.result?.decidedBy.type, "human")
        XCTAssertNotNil(list.tasks[0].payloadText)
        XCTAssertNil(ask.payloadText)
        XCTAssertEqual(list.tasks.newestFirst().map(\.id), ["task-7f3a", "task-81b0"])
    }

    func testDecideRequestExample() throws {
        let data = try Examples.data("decide.request.json")
        let example = try Examples.object(data)
        let teach = try XCTUnwrap(example["teach"] as? [String: String])
        let decision = Decision.approve(reason: example["reason"] as? String, payloadDigest: example["payloadDigest"] as? String,
                                        teach: TeachChoice(option: teach["option"]!, text: teach["text"]))
        XCTAssertEqual(try Examples.object(JSONEncoder().encode(decision)), example)
    }

    func testDeviceExample() throws {
        let data = try Examples.data("device.json")
        let device = try JSONDecoder().decode(Device.self, from: data)
        XCTAssertEqual(device.platform, "apns")
        XCTAssertEqual(device.environment, .production)
        XCTAssertEqual(device.name, "Alice's iPhone")
        XCTAssertEqual(try Examples.object(JSONEncoder().encode(device.registration)), try Examples.object(data))
    }

    /// decide.request.schema.json: an Approve body has `outcome` (approve|reject),
    /// optional `reason` and `payloadDigest`, nothing else; an Ask body has
    /// `answer` and optional `reason`, nothing else.
    func testDecisionEncodingsFitTheSchema() throws {
        let reject = try Examples.object(JSONEncoder().encode(Decision.reject(reason: "wrong tag", payloadDigest: "sha256:1")))
        XCTAssertEqual(reject, ["outcome": "reject", "reason": "wrong tag", "payloadDigest": "sha256:1"])
        let bare = try Examples.object(JSONEncoder().encode(Decision.approve(reason: "  ", payloadDigest: nil)))
        XCTAssertEqual(bare, ["outcome": "approve"])
        // Teach (spec 5.5): just this once sends nothing; a non-editable option sends no text.
        let once = try Examples.object(JSONEncoder().encode(Decision.approve(reason: nil, payloadDigest: nil, teach: TeachChoice.choosing(nil, text: "x"))))
        XCTAssertEqual(once, ["outcome": "approve"])
        let never = TeachOption(id: "never-allow", label: "Never allow this", after: [.reject])
        let taught = try Examples.object(JSONEncoder().encode(Decision.reject(reason: "no", payloadDigest: nil, teach: TeachChoice.choosing(never, text: "ignored"))))
        XCTAssertEqual(taught as NSDictionary, ["outcome": "reject", "reason": "no", "teach": ["option": "never-allow"]] as NSDictionary)
        let always = TeachOption(id: "always-allow", label: "Always", after: [.approve], editable: .init(label: "Pattern", default: "ls *"))
        let edited = try Examples.object(JSONEncoder().encode(Decision.approve(reason: nil, payloadDigest: nil, teach: TeachChoice.choosing(always, text: "ls -la *"))))
        XCTAssertEqual(edited as NSDictionary, ["outcome": "approve", "teach": ["option": "always-allow", "text": "ls -la *"]] as NSDictionary)
        let answer = try Examples.object(JSONEncoder().encode(Decision.answer(.number(3), reason: nil)))
        XCTAssertEqual(answer, ["answer": 3])
        let withReason = try Examples.object(JSONEncoder().encode(Decision.answer(.string("EUR"), reason: "invoice")))
        XCTAssertEqual(withReason, ["answer": "EUR", "reason": "invoice"])
    }

    /// device.schema.json: `platform` and `token` required, `environment` production|sandbox.
    func testDeviceEncodingFitsTheSchema() throws {
        var device = Device(token: "abc", environment: .sandbox, name: "Phone")
        device.id = "server-filled"
        let body = try Examples.object(JSONEncoder().encode(device.registration))
        XCTAssertEqual(body, ["platform": "apns", "token": "abc", "environment": "sandbox", "name": "Phone"])
    }
}
