import SwiftUI
import HITLPSurfaceKit

/// The confirmation step of a decision: Reject asks for a reason, Approve
/// offers one, an Ask takes its answer. Approve and Reject send the
/// `payloadDigest` of the view on screen.
struct DecisionSheet: View {
    enum Kind: String, Identifiable { case approve, reject, answer; var id: String { rawValue } }

    let kind: Kind
    let task: TaskView
    let send: (Decision) async -> String?

    @Environment(\.dismiss) private var dismiss
    @State private var reason = ""
    @State private var answer: JSONValue?
    @State private var error: String?
    @State private var sending = false

    var body: some View {
        NavigationStack {
            Form {
                Section { Text(task.headline).font(.headline) }
                if kind == .answer {
                    AskInputView(task: task, answer: $answer)
                }
                Section(kind == .reject ? "Reason (required)" : "Reason (optional)") {
                    TextField("Reason", text: $reason, axis: .vertical).lineLimit(2...5)
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(confirm, role: kind == .reject ? .destructive : nil) { Task { await submit() } }
                        .disabled(!ready || sending)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var title: String {
        switch kind { case .approve: "Approve?"; case .reject: "Reject?"; case .answer: "Answer" }
    }
    private var confirm: String {
        switch kind { case .approve: "Approve"; case .reject: "Reject"; case .answer: "Send" }
    }
    private var trimmed: String? {
        let r = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        return r.isEmpty ? nil : r
    }
    private var ready: Bool {
        switch kind {
        case .approve: return true
        case .reject: return trimmed != nil
        case .answer: return answer != nil
        }
    }

    private func submit() async {
        sending = true
        defer { sending = false }
        let decision: Decision
        switch kind {
        case .approve: decision = .approve(reason: trimmed, payloadDigest: task.payloadDigest)
        case .reject: decision = .reject(reason: trimmed, payloadDigest: task.payloadDigest)
        case .answer:
            guard let answer else { return }
            decision = .answer(answer, reason: trimmed)
        }
        if let e = await send(decision) { error = e } else { dismiss() }
    }
}
