import Foundation

/// The task id a push carries (spec 7.8: only a title and the task id, never
/// request content; the server's `src/push.ts` puts it at `taskId`). The app
/// fetches the task with its own credential.
public enum PushPayload {
    public static func taskId(from userInfo: [AnyHashable: Any]) -> String? {
        guard let id = userInfo["taskId"] as? String, !id.isEmpty else { return nil }
        return id
    }

    /// The task id of a "no longer open" push (`event: "closed"`, a background
    /// push): the app removes the delivered alert for that task. Nil for any
    /// other push.
    public static func closedTaskId(from userInfo: [AnyHashable: Any]) -> String? {
        guard userInfo["event"] as? String == "closed" else { return nil }
        return taskId(from: userInfo)
    }
}
