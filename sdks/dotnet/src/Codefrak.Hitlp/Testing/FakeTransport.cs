using System.Text.Json;
using System.Text.Json.Nodes;

namespace Codefrak.Hitlp.Testing;

/// <summary>
/// An in-memory <see cref="TaskTransport"/> for unit tests. It is NOT a HITLP server:
/// an in-memory task store is not conforming (rule R1). Tests drive decisions with
/// <see cref="Complete"/> and <see cref="SetStatus"/>.
/// </summary>
public class FakeTransport : TaskTransport
{
    /// <summary>One recorded <c>CallToolAsync</c>.</summary>
    public sealed record Call(string Name, JsonObject Args);

    private readonly object _lock = new();
    private readonly Dictionary<string, HitlpTask> _tasks = new();
    private readonly Dictionary<string, string> _byKey = new();
    private readonly long? _pollInterval;
    private int _next = 1;

    /// <param name="pollInterval">the interval tasks report, or null for none</param>
    public FakeTransport(long? pollInterval = 500)
    {
        _pollInterval = pollInterval;
    }

    public List<Call> Calls { get; } = new();

    public List<string> Gets { get; } = new();

    public List<string> Cancels { get; } = new();

    /// <summary>Fail the next N <c>CallToolAsync</c>s after recording them (a lost response).</summary>
    public int FailNextCalls { get; set; }

    public override Task<HitlpTask> CallToolAsync(string name, JsonObject args, CancellationToken cancellationToken = default)
    {
        lock (_lock)
        {
            Calls.Add(new Call(name, args));
            var key = args["idempotencyKey"]?.ToString() ?? "";
            if (!_byKey.TryGetValue(key, out var id))
            {
                id = "task-" + _next++;
                _byKey[key] = id;
                _tasks[id] = new HitlpTask(id, HitlpTaskStatus.Working, 3_600_000L, _pollInterval);
            }
            if (FailNextCalls > 0)
            {
                FailNextCalls--;
                throw new InvalidOperationException("connection lost");
            }
            return Task.FromResult(_tasks[id]);
        }
    }

    public override Task<HitlpTask> GetTaskAsync(string taskId, CancellationToken cancellationToken = default)
    {
        lock (_lock)
        {
            Gets.Add(taskId);
            return Task.FromResult(Must(taskId));
        }
    }

    public override Task<HitlpTask> CancelTaskAsync(string taskId, CancellationToken cancellationToken = default)
    {
        lock (_lock)
        {
            Cancels.Add(taskId);
            var t = Must(taskId);
            if (t.Status != HitlpTaskStatus.Completed && t.Status != HitlpTaskStatus.Failed)
            {
                t = t with { Status = HitlpTaskStatus.Cancelled };
                _tasks[taskId] = t;
            }
            return Task.FromResult(t);
        }
    }

    public void SetStatus(string taskId, HitlpTaskStatus status, string? statusMessage = null)
    {
        lock (_lock) _tasks[taskId] = Must(taskId) with { Status = status, StatusMessage = statusMessage };
    }

    /// <summary>Sets the task's <c>_meta</c> (and so its <see cref="HitlpTask.DecisionUrl"/>); null clears it.</summary>
    public void SetMeta(string taskId, JsonObject? meta)
    {
        JsonElement? element = meta == null ? null : JsonDocument.Parse(meta.ToJsonString()).RootElement.Clone();
        lock (_lock) _tasks[taskId] = Must(taskId) with { Meta = element };
    }

    /// <summary>Completes the task with a decision record; <c>requestId</c> defaults to the task id.</summary>
    public void Complete(string taskId, JsonObject record)
    {
        var r = new JsonObject { ["requestId"] = taskId };
        foreach (var (k, v) in record) r[k] = v?.DeepClone();
        lock (_lock)
        {
            _tasks[taskId] = Must(taskId) with { Status = HitlpTaskStatus.Completed, StatusMessage = null, Result = DecisionRecord.Of(r) };
        }
    }

    private HitlpTask Must(string taskId) =>
        _tasks.TryGetValue(taskId, out var t) ? t : throw new ArgumentException("no task " + taskId);
}
