using System.Text.Json.Nodes;

namespace Codefrak.Hitlp;

/// <summary>
/// The few MCP Tasks operations HITLP needs. Adapt your MCP client to it:
/// <see cref="CallToolAsync"/> is a task-augmented <c>tools/call</c> that returns the
/// handle at once, <see cref="GetTaskAsync"/> is <c>tasks/get</c> (with the result
/// attached once terminal), and <see cref="CancelTaskAsync"/> is <c>tasks/cancel</c>.
/// Keeping it this small means the SDK does not depend on which MCP SDK, or which
/// version of the Tasks extension, you use.
/// </summary>
public abstract class TaskTransport
{
    public abstract Task<HitlpTask> CallToolAsync(string name, JsonObject args, CancellationToken cancellationToken = default);

    public abstract Task<HitlpTask> GetTaskAsync(string taskId, CancellationToken cancellationToken = default);

    public abstract Task<HitlpTask> CancelTaskAsync(string taskId, CancellationToken cancellationToken = default);
}
