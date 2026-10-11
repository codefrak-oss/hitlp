import Foundation

/// What a surface API call can fail with, one case per status the spec names (7.8).
public enum SurfaceError: Error, Equatable, LocalizedError, Sendable {
    /// 400: a malformed decision, or an answer the task's schema refuses; the server's `error` text.
    case badRequest(String)
    /// 401: the credential is missing or refused.
    case credentialRefused
    /// 404: the task does not exist or is not routed to this human.
    case taskUnknown
    /// 409: the task was already decided, or its payload changed since it was shown.
    case conflict(String)
    /// Any other status.
    case unexpectedStatus(Int, String)
    /// The server's answer did not decode.
    case malformed(String)
    /// No answer at all (offline, DNS, TLS).
    case transport(String)

    public var errorDescription: String? {
        switch self {
        case .badRequest(let m): return "The server refused the decision: \(m)"
        case .credentialRefused: return "The server refused this credential. Check it in Settings."
        case .taskUnknown: return "This task is unknown, or not routed to you."
        case .conflict: return "This task was already decided, or its payload changed. It has been reloaded."
        case .unexpectedStatus(let s, let m): return "The server answered \(s)\(m.isEmpty ? "" : ": \(m)")."
        case .malformed(let m): return "The server's answer could not be read: \(m)"
        case .transport(let m): return "The server could not be reached: \(m)"
        }
    }

    static func from(status: Int, body: Data) -> SurfaceError {
        let message = (try? JSONDecoder().decode([String: String].self, from: body))?["error"]
            ?? String(decoding: body, as: UTF8.self)
        switch status {
        case 400: return .badRequest(message)
        case 401: return .credentialRefused
        case 404: return .taskUnknown
        case 409: return .conflict(message)
        default: return .unexpectedStatus(status, message)
        }
    }
}
