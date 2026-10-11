import Foundation

/// The body of `POST /tasks/{id}/decision` (schemas/surface/decide.request.schema.json).
public enum Decision: Encodable, Equatable, Sendable {
    /// An Approve's decision; `payloadDigest` is the digest of the view the human saw.
    case approve(reason: String?, payloadDigest: String?)
    case reject(reason: String?, payloadDigest: String?)
    /// An Ask's answer.
    case answer(JSONValue, reason: String?)

    enum CodingKeys: String, CodingKey { case outcome, reason, payloadDigest, answer }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .approve(let reason, let digest), .reject(let reason, let digest):
            try c.encode(self.isApprove ? "approve" : "reject", forKey: .outcome)
            try c.encodeIfPresent(reason.nonEmpty, forKey: .reason)
            try c.encodeIfPresent(digest, forKey: .payloadDigest)
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

extension Optional where Wrapped == String {
    var nonEmpty: String? {
        guard let s = self?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return s
    }
}
