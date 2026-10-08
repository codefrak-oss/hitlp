namespace Codefrak.Hitlp;

/// <summary>
/// A HITLP client over MCP Tasks. <see cref="AskAsync"/> and <see cref="ApproveAsync"/>
/// return the task handle at once (rule R1); checkpoint it (R3), then
/// <see cref="WaitForTerminalAsync(HitlpTask, WaitOptions?, CancellationToken)"/> or
/// <see cref="ResumeAsync"/>. Transport exceptions propagate unchanged.
/// </summary>
public sealed class HitlpClient
{
    private readonly TaskTransport _transport;
    private readonly HitlpClientOptions _options;

    public HitlpClient(TaskTransport transport, HitlpClientOptions? options = null)
    {
        _transport = transport;
        _options = options ?? new HitlpClientOptions();
    }

    /// <summary>Calls <c>human.ask</c>; returns the task handle without waiting for a human.</summary>
    public Task<HitlpTask> AskAsync(AskRequest request, CancellationToken cancellationToken = default) =>
        CallAsync(Tools.AskTool, request, cancellationToken);

    /// <summary>Calls <c>human.approve</c>; returns the task handle without waiting for a human.</summary>
    public Task<HitlpTask> ApproveAsync(ApproveRequest request, CancellationToken cancellationToken = default) =>
        CallAsync(Tools.ApproveTool, request, cancellationToken);

    /// <summary><c>tasks/get</c>. Prefer <c>WaitForTerminalAsync</c>, which respects <c>pollInterval</c>.</summary>
    public Task<HitlpTask> GetAsync(string taskId, CancellationToken cancellationToken = default) =>
        _transport.GetTaskAsync(taskId, cancellationToken);

    /// <summary><c>tasks/cancel</c>.</summary>
    public Task<HitlpTask> CancelAsync(string taskId, CancellationToken cancellationToken = default) =>
        _transport.CancelTaskAsync(taskId, cancellationToken);

    public async Task<HitlpTask> WaitForTerminalAsync(string taskId, WaitOptions? options = null, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return await WaitForTerminalAsync(await GetAsync(taskId, cancellationToken).ConfigureAwait(false), options, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>
    /// Polls <c>tasks/get</c> until the task is terminal, never more often than the
    /// server's <c>pollInterval</c> (spec 7.4), and validates the decision record.
    /// Throws <see cref="OperationCanceledException"/> once the token is cancelled;
    /// that stops the wait, not the task: call <see cref="CancelAsync"/> for that.
    /// </summary>
    public async Task<HitlpTask> WaitForTerminalAsync(HitlpTask task, WaitOptions? options = null, CancellationToken cancellationToken = default)
    {
        HitlpTaskStatus? previous = null;
        while (!task.Status.IsTerminal())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (task.Status == HitlpTaskStatus.InputRequired && previous != HitlpTaskStatus.InputRequired)
                options?.OnInputRequired?.Invoke(task);
            previous = task.Status;
            var interval = task.PollInterval.HasValue ? TimeSpan.FromMilliseconds(task.PollInterval.Value) : _options.DefaultPollInterval;
            await _options.Delay(interval < TimeSpan.Zero ? TimeSpan.Zero : interval, cancellationToken).ConfigureAwait(false);
            task = await GetAsync(task.TaskId, cancellationToken).ConfigureAwait(false);
        }
        var r = task.Result;
        if (r != null) Validation.AssertValid(r.Primitive == "approve" ? SchemaName.ApproveResponse : SchemaName.AskResponse, r);
        return task;
    }

    /// <summary>Waits for a checkpointed task and interprets how it ended (rule R3).</summary>
    public async Task<Resolution> ResumeAsync(Checkpoint checkpoint, WaitOptions? options = null, CancellationToken cancellationToken = default)
    {
        var task = await WaitForTerminalAsync(checkpoint.TaskId, options, cancellationToken).ConfigureAwait(false);
        var r = task.Result;
        if (r != null && (checkpoint.IdempotencyKey != r.IdempotencyKey || checkpoint.Primitive.ToWire() != r.Primitive))
        {
            throw new InvalidOperationException("task " + checkpoint.TaskId + " does not match its checkpoint");
        }
        return Decisions.Resolve(task);
    }

    private async Task<HitlpTask> CallAsync(string name, Request request, CancellationToken cancellationToken)
    {
        Tools.AssertCallableTool(name);
        Validation.AssertValid(request.Primitive == Primitive.Ask ? SchemaName.AskRequest : SchemaName.ApproveRequest, request);
        // Every attempt sends the same arguments, so the same idempotency key (R4):
        // a retry after a lost response returns the existing handle.
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                return await _transport.CallToolAsync(name, request.ToJson(), cancellationToken).ConfigureAwait(false);
            }
            catch (Exception e) when (attempt < _options.CallRetries && e is not OperationCanceledException)
            {
            }
        }
    }
}

/// <summary>Client options.</summary>
public sealed class HitlpClientOptions
{
    /// <summary>Poll interval when the server gives none. Default 1 second.</summary>
    public TimeSpan DefaultPollInterval { get; set; } = TimeSpan.FromSeconds(1);

    /// <summary>How many times to retry a failed <c>tools/call</c> with the same idempotency key (R4). Default 2.</summary>
    public int CallRetries { get; set; } = 2;

    /// <summary>How the client waits between polls; injectable for tests. Default <see cref="Task.Delay(TimeSpan, CancellationToken)"/>.</summary>
    public Func<TimeSpan, CancellationToken, Task> Delay { get; set; } = Task.Delay;
}

/// <summary>Options for <c>WaitForTerminalAsync</c> and <c>ResumeAsync</c>.</summary>
public sealed class WaitOptions
{
    /// <summary>
    /// Called once per entry into <c>input_required</c> (spec 7.3): when the wait starts on an
    /// <c>input_required</c> task, or a poll sees it after another status. The task carries that
    /// poll's <see cref="HitlpTask.Meta"/> and <see cref="HitlpTask.DecisionUrl"/>. Polling goes on.
    /// </summary>
    public Action<HitlpTask>? OnInputRequired { get; set; }
}
