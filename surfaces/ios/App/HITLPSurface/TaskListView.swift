import SwiftUI
import HITLPSurfaceKit

/// Open and recently decided tasks, newest first, kept current by `/events`.
struct TaskListView: View {
    @Environment(AppModel.self) private var model
    @State private var showSettings = false
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if !model.isConfigured {
                    ContentUnavailableView("No server", systemImage: "server.rack",
                        description: Text("Add a server's surface URL and credential in Settings."))
                }
                if let error = model.error {
                    Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                }
                let open = model.tasks.filter { $0.status.isOpen }
                let decided = model.tasks.filter { !$0.status.isOpen }
                if !open.isEmpty {
                    Section("Open") { ForEach(open) { row($0) } }
                }
                if !decided.isEmpty {
                    Section("Recently decided") { ForEach(decided) { row($0) } }
                }
                if model.isConfigured, model.error == nil, model.tasks.isEmpty, !model.loading {
                    Text("Nothing to decide.").foregroundStyle(.secondary)
                }
            }
            .navigationTitle(model.active?.name ?? "HITLP")
            .navigationDestination(for: String.self) { TaskDetailView(taskId: $0) }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                }
            }
            .refreshable { await model.refresh() }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .task { await model.refresh() }
            .onAppear { model.startEvents() }
            .onDisappear { model.stopEvents() }
            .onChange(of: model.openTaskId) { _, id in
                guard let id else { return }
                path = [id]
                model.openTaskId = nil
            }
        }
    }

    private func row(_ task: TaskView) -> some View {
        NavigationLink(value: task.id) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(task.primitive == .approve ? "APPROVE" : "ASK")
                        .font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(task.primitive == .approve ? Color.indigo.opacity(0.35) : Color.teal.opacity(0.35), in: Capsule())
                    StatusBadge(status: task.status)
                    Spacer()
                    if let deadline = task.deadlineDate {
                        Text(deadline, style: task.status.isOpen ? .relative : .date)
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text(task.headline).font(.body).lineLimit(2)
            }
        }
    }
}

struct StatusBadge: View {
    let status: TaskView.Status
    var body: some View {
        Text(label).font(.caption2).foregroundStyle(color)
    }
    private var label: String {
        switch status {
        case .working: return "open"
        case .inputRequired: return "input required"
        case .completed: return "decided"
        case .failed: return "failed"
        case .cancelled: return "cancelled"
        }
    }
    private var color: Color {
        switch status {
        case .working, .inputRequired: return .yellow
        case .completed: return .green
        case .failed, .cancelled: return .secondary
        }
    }
}
