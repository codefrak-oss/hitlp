import Foundation

/// Parses `GET /events` (text/event-stream, spec 7.8) line by line: each
/// `event: task` record yields its `data`, the task view; comment lines
/// (keep-alives) and other events yield nothing.
public struct SSEParser: Sendable {
    public struct Event: Equatable, Sendable {
        public var event: String
        public var id: String?
        public var data: String
    }

    private var event = ""
    private var id: String?
    private var data: [String] = []

    public init() {}

    /// Feeds one line without its terminator; answers an event when the line ends one.
    public mutating func feed(line raw: String) -> Event? {
        let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw
        if line.isEmpty { return dispatch() }
        if line.hasPrefix(":") { return nil }
        let field: Substring, value: Substring
        if let colon = line.firstIndex(of: ":") {
            field = line[..<colon]
            var v = line[line.index(after: colon)...]
            if v.hasPrefix(" ") { v = v.dropFirst() }
            value = v
        } else {
            field = Substring(line); value = ""
        }
        switch field {
        case "event": event = String(value)
        case "id": id = String(value)
        case "data": data.append(String(value))
        default: break
        }
        return nil
    }

    private mutating func dispatch() -> Event? {
        defer { event = ""; id = nil; data = [] }
        guard !data.isEmpty else { return nil }
        return Event(event: event.isEmpty ? "message" : event, id: id, data: data.joined(separator: "\n"))
    }

    /// Parses a whole stream's text into the task views of its `task` events.
    public static func tasks(in text: String) -> [TaskView] {
        var parser = SSEParser()
        var out: [TaskView] = []
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if let task = parser.feed(line: String(line)).flatMap(Self.task(from:)) { out.append(task) }
        }
        return out
    }

    /// The task view a `task` event carries; nil for any other event.
    public static func task(from event: Event) -> TaskView? {
        guard event.event == "task" else { return nil }
        return try? TaskView.decode(text: Substring(event.data))
    }
}
