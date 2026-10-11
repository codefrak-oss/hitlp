import Foundation

/// Finds members of a JSON text without re-encoding them, so an Approve's
/// `payload` can be shown exactly as the server sent it (spec 7.8: "payload
/// exactly as received"): same key order, same number spelling.
enum RawJSON {
    /// The text of each member of the top-level object, by name.
    static func members(of text: Substring) -> [String: Substring] {
        var s = Scanner(text)
        var out: [String: Substring] = [:]
        s.skipSpace()
        guard s.take("{") else { return out }
        while true {
            s.skipSpace()
            if s.take("}") { return out }
            guard let keyRange = s.string() else { return out }
            let key = (try? JSONDecoder().decode(String.self, from: Data(text[keyRange].utf8))) ?? ""
            s.skipSpace()
            guard s.take(":") else { return out }
            s.skipSpace()
            guard let value = s.value() else { return out }
            out[key] = text[value]
            s.skipSpace()
            _ = s.take(",")
        }
    }

    /// The text of each element of a top-level array.
    static func elements(of text: Substring) -> [Substring] {
        var s = Scanner(text)
        var out: [Substring] = []
        s.skipSpace()
        guard s.take("[") else { return out }
        while true {
            s.skipSpace()
            if s.take("]") { return out }
            guard let value = s.value() else { return out }
            out.append(text[value])
            s.skipSpace()
            _ = s.take(",")
        }
    }

    private struct Scanner {
        let text: Substring
        var i: Substring.Index
        init(_ text: Substring) { self.text = text; i = text.startIndex }

        mutating func skipSpace() {
            while i < text.endIndex, text[i].isWhitespace { i = text.index(after: i) }
        }

        mutating func take(_ c: Character) -> Bool {
            guard i < text.endIndex, text[i] == c else { return false }
            i = text.index(after: i)
            return true
        }

        mutating func string() -> Range<Substring.Index>? {
            let start = i
            guard take("\"") else { return nil }
            while i < text.endIndex {
                let c = text[i]
                i = text.index(after: i)
                if c == "\\" { if i < text.endIndex { i = text.index(after: i) } }
                else if c == "\"" { return start..<i }
            }
            return nil
        }

        mutating func value() -> Range<Substring.Index>? {
            guard i < text.endIndex else { return nil }
            let start = i
            switch text[i] {
            case "\"": return string()
            case "{", "[":
                var depth = 0
                while i < text.endIndex {
                    let c = text[i]
                    if c == "\"" { _ = string(); continue }
                    i = text.index(after: i)
                    if c == "{" || c == "[" { depth += 1 }
                    if c == "}" || c == "]" { depth -= 1; if depth == 0 { return start..<i } }
                }
                return nil
            default:
                while i < text.endIndex, !",}] \n\r\t".contains(text[i]) { i = text.index(after: i) }
                return start..<i
            }
        }
    }
}
