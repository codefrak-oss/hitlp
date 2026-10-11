import SwiftUI
import HITLPSurfaceKit

/// An Ask's input: a picker over `options` when present, otherwise a control
/// matched to the `responseSchema`'s type (string, number, integer, boolean,
/// enum). Anything else is typed as JSON. The server validates the answer;
/// a 400 shows its `error` text.
struct AskInputView: View {
    let task: TaskView
    @Binding var answer: JSONValue?

    @State private var text = ""
    @State private var flag = false
    @State private var choice = -1

    enum Input { case choice([JSONValue]), string, number, integer, boolean, json }

    var body: some View {
        Section {
            Text(task.question ?? "").font(.body)
            switch input {
            case .choice(let values):
                Picker("Answer", selection: $choice) {
                    Text("Choose…").tag(-1)
                    ForEach(Array(values.enumerated()), id: \.offset) { i, v in Text(label(v)).tag(i) }
                }
                .pickerStyle(.inline)
                .onChange(of: choice) { _, i in answer = values.indices.contains(i) ? values[i] : nil }
            case .boolean:
                Toggle("Yes", isOn: $flag)
                    .onAppear { answer = .bool(flag) }
                    .onChange(of: flag) { _, f in answer = .bool(f) }
            case .string:
                TextField("Answer", text: $text, axis: .vertical)
                    .onChange(of: text) { _, t in answer = t.isEmpty ? nil : .string(t) }
            case .number, .integer:
                TextField(input.isInteger ? "Whole number" : "Number", text: $text)
                    .keyboardType(input.isInteger ? .numberPad : .decimalPad)
                    .onChange(of: text) { _, t in answer = number(t) }
            case .json:
                TextField("Answer as JSON", text: $text, axis: .vertical)
                    .font(.system(.body, design: .monospaced))
                    .autocorrectionDisabled().textInputAutocapitalization(.never)
                    .onChange(of: text) { _, t in answer = try? JSONDecoder().decode(JSONValue.self, from: Data(t.utf8)) }
            }
        } header: {
            Text("Question")
        }
    }

    private var input: Input {
        if let options = task.options, !options.isEmpty { return .choice(options) }
        let schema = task.responseSchema
        if case .array(let values)? = schema?["enum"] { return .choice(values) }
        switch schema?["type"]?.stringValue {
        case "string": return .string
        case "number": return .number
        case "integer": return .integer
        case "boolean": return .boolean
        default: return .json
        }
    }

    private func number(_ t: String) -> JSONValue? {
        let s = t.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        if input.isInteger { return Int(s).map { .number(Double($0)) } }
        return Double(s).map { .number($0) }
    }

    /// An option's label: its `label` member when it has one, else the value itself.
    private func label(_ v: JSONValue) -> String {
        if let l = v["label"]?.stringValue { return l }
        return v.stringValue ?? v.jsonText
    }
}

private extension AskInputView.Input {
    var isInteger: Bool { if case .integer = self { return true }; return false }
}
