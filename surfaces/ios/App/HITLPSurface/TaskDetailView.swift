import SwiftUI
import HITLPSurfaceKit

/// One task: what is asked and the recommendation first, then who (attested)
/// and why (asserted), the payload in full, and the decision controls.
struct TaskDetailView: View {
    let taskId: String
    @Environment(AppModel.self) private var model
    @State private var task: TaskView?
    @State private var error: String?
    @State private var notice: String?
    @State private var sheet: DecisionSheet.Kind?

    var body: some View {
        List {
            if let notice { Label(notice, systemImage: "info.circle").foregroundStyle(.yellow) }
            if let error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
            if let task { content(task) } else if error == nil { ProgressView() }
        }
        .navigationTitle(task?.primitive == .ask ? "Ask" : "Approve")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $sheet) { kind in
            if let task { DecisionSheet(kind: kind, task: task) { await decide(task, $0) } }
        }
    }

    @ViewBuilder
    private func content(_ task: TaskView) -> some View {
        Section {
            Text(task.headline).font(.title3.bold())
            HStack {
                StatusBadge(status: task.status)
                Spacer()
                if let d = task.deadlineDate { Text("deadline ") + Text(d, style: .relative) }
            }.font(.caption)
            if task.requiresHuman { Label("Requires a human", systemImage: "person.fill").font(.caption) }
            if let m = task.statusMessage { Text(m).font(.caption).foregroundStyle(.secondary) }
        }
        if let rec = task.asserted?.recommendation { RecommendationSection(recommendation: rec) }
        AttestedSection(attested: task.attested)
        AssertedSection(asserted: task.asserted)
        if task.primitive == .approve {
            Section("Payload, exactly as received") {
                ScrollView(.horizontal) {
                    Text(task.payloadText ?? task.payload?.jsonText ?? "null")
                        .font(.system(.footnote, design: .monospaced))
                        .textSelection(.enabled)
                }
                if let digest = task.payloadDigest {
                    LabeledContent("Digest") { Text(digest).font(.caption.monospaced()).textSelection(.enabled) }
                }
            }
        }
        if let context = task.context {
            Section("Context (from the requester)") {
                Text(context.jsonText).font(.system(.footnote, design: .monospaced))
            }.listRowBackground(Color.orange.opacity(0.10))
        }
        if let result = task.result {
            Section("Decision") {
                LabeledContent("Outcome", value: result.outcome)
                if let answer = result.answer { LabeledContent("Answer", value: answer.stringValue ?? answer.jsonText) }
                if let reason = result.reason { LabeledContent("Reason", value: reason) }
                LabeledContent("By", value: [result.decidedBy.type, result.decidedBy.id].compactMap { $0 }.joined(separator: " "))
                if let channel = result.channel { LabeledContent("Channel", value: channel) }
                LabeledContent("At", value: result.decidedAt)
            }
        } else if task.status.isOpen {
            Section {
                if task.primitive == .approve {
                    // Deliberate taps only: each opens a confirmation sheet.
                    HStack(spacing: 16) {
                        Button("Reject", role: .destructive) { sheet = .reject }
                            .buttonStyle(.bordered).frame(maxWidth: .infinity)
                        Button("Approve") { sheet = .approve }
                            .buttonStyle(.borderedProminent).frame(maxWidth: .infinity)
                    }
                } else {
                    Button("Answer") { sheet = .answer }.buttonStyle(.borderedProminent).frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func load() async {
        if model.client == nil { await model.refresh() }
        guard let client = model.client else {
            error = model.error ?? "No server answers."
            return
        }
        do {
            let t = try await client.task(id: taskId)
            task = t
            model.upsert(t)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Sends a decision; answers the error text to show in the sheet, or nil when done.
    private func decide(_ task: TaskView, _ decision: Decision) async -> String? {
        guard let client = model.client else { return "No server answers." }
        do {
            try await client.decide(taskId: task.id, decision)
            notice = nil
            await load()
            return nil
        } catch let e as SurfaceError {
            if case .conflict = e {
                notice = e.localizedDescription
                await load()
                return nil
            }
            return e.localizedDescription
        } catch {
            return error.localizedDescription
        }
    }
}
