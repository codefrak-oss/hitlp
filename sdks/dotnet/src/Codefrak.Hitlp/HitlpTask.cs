namespace Codefrak.Hitlp;

/// <summary>
/// A task handle as the transport reports it (spec 7.2). Immutable; use <c>with</c>
/// expressions for copies. Named <c>HitlpTask</c> so it does not clash with
/// <see cref="System.Threading.Tasks.Task"/>.
/// </summary>
/// <param name="TaskId">the task id</param>
/// <param name="Status">the task status</param>
/// <param name="Ttl">effective deadline in milliseconds from creation, as the server reports it, or null</param>
/// <param name="PollInterval">minimum milliseconds between <c>tasks/get</c> calls, or null</param>
/// <param name="StatusMessage">the server's status message, or null</param>
/// <param name="Result">the decision record, once the server has one (terminal tasks; spec 7.3), or null</param>
public sealed record HitlpTask(
    string TaskId,
    HitlpTaskStatus Status,
    long? Ttl = null,
    long? PollInterval = null,
    string? StatusMessage = null,
    DecisionRecord? Result = null);
