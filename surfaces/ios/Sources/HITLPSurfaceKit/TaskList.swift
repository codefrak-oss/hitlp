import Foundation

/// `GET /tasks`'s answer (schemas/surface/task-list.schema.json).
public struct TaskList: Decodable, Equatable, Sendable {
    public var tasks: [TaskView]

    /// Decodes the list and keeps each payload's text as received.
    public static func decode(_ data: Data) throws -> TaskList {
        var list = try JSONDecoder().decode(TaskList.self, from: data)
        let text = Substring(String(decoding: data, as: UTF8.self))
        if let raw = RawJSON.members(of: text)["tasks"] {
            let elements = RawJSON.elements(of: raw)
            if elements.count == list.tasks.count {
                for (i, element) in elements.enumerated() {
                    if let p = RawJSON.members(of: element)["payload"] { list.tasks[i].payloadText = String(p) }
                }
            }
        }
        return list
    }
}

extension Array where Element == TaskView {
    /// Newest first by `createdAt`, as the list shows them.
    public func newestFirst() -> [TaskView] {
        sorted { ($0.createdDate ?? .distantPast) > ($1.createdDate ?? .distantPast) }
    }

    /// Inserts or replaces a task by id, then orders newest first.
    public func upserting(_ task: TaskView) -> [TaskView] {
        var copy = filter { $0.id != task.id }
        copy.append(task)
        return copy.newestFirst()
    }
}
