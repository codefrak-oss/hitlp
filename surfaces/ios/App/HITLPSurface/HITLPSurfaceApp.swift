import SwiftUI

@main
struct HITLPSurfaceApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel.shared

    var body: some Scene {
        WindowGroup {
            TaskListView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(.indigo)
        }
    }
}
