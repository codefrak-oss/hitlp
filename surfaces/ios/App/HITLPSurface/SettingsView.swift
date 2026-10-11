import SwiftUI
import HITLPSurfaceKit

/// The two server entries: a name, a base URL ending `/surface/v1`, and a
/// surface credential each. Saved to the Keychain only.
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var draft: [ServerConfig] = []

    var body: some View {
        NavigationStack {
            Form {
                ForEach($draft) { $server in
                    Section {
                        TextField("Name", text: $server.name)
                        TextField("https://host/surface/v1", text: $server.baseURL)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        SecureField("Surface credential", text: $server.credential)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                        if model.active?.id == server.id { Label("In use", systemImage: "checkmark.circle").foregroundStyle(.green) }
                    } header: {
                        Text(server.name.isEmpty ? "Server" : server.name)
                    } footer: {
                        if !server.baseURL.isEmpty && !server.baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")).hasSuffix("/surface/v1") {
                            Text("The base URL must end in /surface/v1.").foregroundStyle(.orange)
                        }
                        if !server.baseURL.isEmpty && !server.baseURL.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("https://") {
                            Text("The base URL must use https.").foregroundStyle(.orange)
                        }
                    }
                }
                Section {
                    Text("The app uses the first server, in this order, that answers. Credentials stay in this phone's Keychain.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let e = model.pushError { Text("Push: \(e)").font(.footnote).foregroundStyle(.orange) }
                }
            }
            .navigationTitle("Servers")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await model.saveServers(draft); dismiss() } }
                }
            }
            .onAppear { draft = model.servers }
        }
    }
}
