import Foundation

/// The body of `POST /tasks/{id}/decision` (schemas/surface/decide.request.schema.json).
public enum Decision: Encodable, Equatable, Sendable {
    /// An Approve's decision; `payloadDigest` is the digest of the view the human saw,
    /// `teach` the human's teach choice (spec 5.5), nil for "just this once".
    case approve(reason: String?, payloadDigest: String?, teach: TeachChoice? = nil)
    case reject(reason: String?, payloadDigest: String?, teach: TeachChoice? = nil)
    /// An Ask's answer.
    case answer(JSONValue, reason: String?)

    enum CodingKeys: String, CodingKey { case outcome, reason, payloadDigest, answer, teach }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .approve(let reason, let digest, let teach), .reject(let reason, let digest, let teach):
            try c.encode(self.isApprove ? "approve" : "reject", forKey: .outcome)
            try c.encodeIfPresent(reason.nonEmpty, forKey: .reason)
            try c.encodeIfPresent(digest, forKey: .payloadDigest)
            try c.encodeIfPresent(teach, forKey: .teach)
        case .answer(let answer, let reason):
            try c.encode(answer, forKey: .answer)
            try c.encodeIfPresent(reason.nonEmpty, forKey: .reason)
        }
    }

    private var isApprove: Bool {
        if case .approve = self { return true }
        return false
    }
}

/// The human's answer to "teach the judge?" (spec 5.5): an offered option's id and,
/// for an editable option, the text as the human left it.
public struct TeachChoice: Codable, Equatable, Sendable {
    public var option: String
    public var text: String?

    public init(option: String, text: String? = nil) {
        self.option = option
        self.text = text
    }

    /// The choice for `option` with the text the human edited, or nil for "just this once".
    /// An option that is not editable sends no text.
    public static func choosing(_ option: TeachOption?, text: String) -> TeachChoice? {
        guard let option else { return nil }
        return TeachChoice(option: option.id, text: option.editable == nil ? nil : text)
    }
}

extension Optional where Wrapped == String {
    var nonEmpty: String? {
        guard let s = self?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return s
    }
}
