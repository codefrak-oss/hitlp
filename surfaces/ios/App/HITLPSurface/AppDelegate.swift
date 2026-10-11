import SwiftUI
import UserNotifications
import HITLPSurfaceKit

/// Push: asks for permission and registers on launch, puts the APNs token on
/// every configured server (`PUT /devices/{deviceId}`), and opens the task a
/// tapped notification names. A notification carries only a title and the
/// task id; the task itself is fetched with the app's credential.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        // Register whatever the answer: the token is harmless without permission,
        // and the server keeps it for when the user allows alerts in Settings.
        application.registerForRemoteNotifications()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in await AppModel.shared.registerDevice(token: token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in AppModel.shared.pushError = error.localizedDescription }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .list]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let id = PushPayload.taskId(from: response.notification.request.content.userInfo) else { return }
        await MainActor.run { AppModel.shared.open(taskId: id) }
    }
}
