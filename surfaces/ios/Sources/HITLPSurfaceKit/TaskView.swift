import Foundation

/// A task as the surface API shows it (spec 7.8, schemas/surface/task.schema.json).
public struct TaskView: Codable, Identifiable, Equatable, Sendable {
    public enum Primitive: String, Codable, Sendable { case ask, approve }
    public enum Status: String, Codable, Sendable {
        case working, inputRequired = "input_required", completed, failed, cancelled
        public var isOpen: Bool { self == .working || self == .inputRequired }
    }

    public var id: String
    public var primitive: Primitive
    public var status: Status
    public var statusMessage: String?
    public var createdAt: String
    public var deadline: String
    public var requiresHuman: Bool
    public var attested: Attested?
    public var asserted: Asserted?
    public var action: String?
    public var payload: JSONValue?
    public var payloadDigest: String?
    public var scope: JSONValue?
    public var question: String?
    public var responseSchema: JSONValue?
    public var options: [JSONValue]?
    public var context: JSONValue?
    public var requires: Requires?
    public var result: DecisionRecord?

    /// The `payload` member's text exactly as the server sent it; set by
    /// `TaskView.decode(_:)`, nil when decoded otherwise or without a payload.
    public var payloadText: String?

    enum CodingKeys: String, CodingKey {
        case id, primitive, status, statusMessage, createdAt, deadline, requiresHuman, attested, asserted
        case action, payload, payloadDigest, scope, question, responseSchema, options, context, requires, result
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        primitive = try c.decode(Primitive.self, forKey: .primitive)
        status = try c.decode(Status.self, forKey: .status)
        statusMessage = try c.decodeIfPresent(String.self, forKey: .statusMessage)
        createdAt = try c.decode(String.self, forKey: .createdAt)
        deadline = try c.decode(String.self, forKey: .deadline)
        requiresHuman = try c.decodeIfPresent(Bool.self, forKey: .requiresHuman) ?? false
        attested = try c.decodeIfPresent(Attested.self, forKey: .attested)
        asserted = try c.decodeIfPresent(Asserted.self, forKey: .asserted)
        action = try c.decodeIfPresent(String.self, forKey: .action)
        // A payload of JSON null is still a payload: keep it as .null.
        payload = c.contains(.payload) ? try c.decode(JSONValue.self, forKey: .payload) : nil
        payloadDigest = try c.decodeIfPresent(String.self, forKey: .payloadDigest)
        scope = try c.decodeIfPresent(JSONValue.self, forKey: .scope)
        question = try c.decodeIfPresent(String.self, forKey: .question)
        responseSchema = try c.decodeIfPresent(JSONValue.self, forKey: .responseSchema)
        options = try c.decodeIfPresent([JSONValue].self, forKey: .options)
        context = try c.decodeIfPresent(JSONValue.self, forKey: .context)
        requires = try c.decodeIfPresent(Requires.self, forKey: .requires)
        result = try c.decodeIfPresent(DecisionRecord.self, forKey: .result)
    }

    /// Decodes one task view and keeps its payload's text as received.
    public static func decode(_ data: Data) throws -> TaskView {
        try decode(text: Substring(String(decoding: data, as: UTF8.self)))
    }

    static func decode(text: Substring) throws -> TaskView {
        var task = try JSONDecoder().decode(TaskView.self, from: Data(text.utf8))
        if let raw = RawJSON.members(of: text)["payload"] { task.payloadText = String(raw) }
        return task
    }

    /// The line a list row leads with: the action for an Approve, the question for an Ask.
    public var headline: String {
        (primitive == .approve ? action : question) ?? id
    }

    /// When the task was created, for ordering newest first.
    public var createdDate: Date? { SurfaceDates.parse(createdAt) }
    public var deadlineDate: Date? { SurfaceDates.parse(deadline) }
}

/// What the server attests (spec 5.1): `source` is always `server`.
public struct Attested: Codable, Equatable, Sendable {
    public var source: String
    public var requester: String
    public var onBehalfOf: JSONValue?
    public var by: String
}

/// What the requester says (spec 5.1): `source` is always `requester`.
public struct Asserted: Codable, Equatable, Sendable {
    public var source: String
    public var why: String?
    public var onBehalfOf: JSONValue?
    public var recommendation: Recommendation?
    /// Newest first, as the server orders it for display (spec 5.3).
    public var lineage: [LineageLink]?
    public var asOf: String?
}

public struct Recommendation: Codable, Equatable, Sendable {
    public enum Verdict: String, Codable, Sendable { case allow, deny, escalate, none }
    public struct By: Codable, Equatable, Sendable {
        public var requester: String?
        public var judge: String?
        public var model: String?
        public var rubric: String?

        /// The judge's name in one line: judge, model, rubric or requester, as given.
        public var label: String {
            [judge, model, rubric.map { "rubric \($0)" }, requester.map { "requester \($0)" }]
                .compactMap { $0 }.joined(separator: " · ")
        }
    }
    public var verdict: Verdict
    public var confidence: Double?
    public var by: By?
    public var reasons: [String]?
}

public struct LineageLink: Codable, Equatable, Sendable {
    public var kind: String
    public var claim: String
    public var source: JSONValue?
    public var by: String?
}

public struct Requires: Codable, Equatable, Sendable {
    public var roles: [String]?
    public var capabilities: [String]?
}

/// The decision record (spec 6) a decided task carries and a decision answers.
public struct DecisionRecord: Codable, Equatable, Sendable {
    public struct DecidedBy: Codable, Equatable, Sendable {
        public var type: String
        public var id: String?
        public var roles: [String]?
    }
    public var requestId: String
    public var primitive: String?
    public var outcome: String
    public var answer: JSONValue?
    public var reason: String?
    public var decidedBy: DecidedBy
    public var decidedAt: String
    public var channel: String?
    public var payloadDigest: String?
}

public enum SurfaceDates {
    public static func parse(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s)
    }
}
