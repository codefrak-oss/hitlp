using System.Text.Json;
using System.Text.Json.Nodes;

namespace Codefrak.Hitlp;

/// <summary>
/// The decision record (spec section 6); it is the task result. A read-only view
/// of the JSON object, with accessors for the fields the SDK interprets.
/// </summary>
public sealed class DecisionRecord
{
    private readonly JsonObject _fields;

    private DecisionRecord(JsonObject fields)
    {
        _fields = fields;
    }

    /// <summary>Wraps a record. Not validated: the client validates what the server sends.</summary>
    public static DecisionRecord Of(JsonObject fields) => new(Json.Copy(fields));

    public string? RequestId => Json.GetString(_fields, "requestId");

    public string? IdempotencyKey => Json.GetString(_fields, "idempotencyKey");

    /// <summary><c>ask</c> or <c>approve</c>, as on the wire.</summary>
    public string? Primitive => Json.GetString(_fields, "primitive");

    /// <summary><c>answered</c>, <c>approved</c>, <c>rejected</c>, <c>timed_out</c> or <c>cancelled</c>.</summary>
    public string? Outcome => Json.GetString(_fields, "outcome");

    /// <summary>The raw answer; prefer <see cref="Decisions.AnswerOf(DecisionRecord?)"/>.</summary>
    public JsonNode? Answer => Get("answer");

    public string? Reason => Json.GetString(_fields, "reason");

    public JsonObject? DecidedBy => Get("decidedBy") as JsonObject;

    public string? DecidedAt => Json.GetString(_fields, "decidedAt");

    public string? PayloadDigest => Json.GetString(_fields, "payloadDigest");

    /// <summary>A copy of one top-level field, or null.</summary>
    public JsonNode? Get(string field) => _fields[field]?.DeepClone();

    public JsonObject ToJson() => Json.Copy(_fields);

    public override string ToString() => _fields.ToJsonString();

    public override bool Equals(object? obj) => obj is DecisionRecord d && JsonNode.DeepEquals(d._fields, _fields);

    public override int GetHashCode() => _fields.ToJsonString().GetHashCode();
}

/// <summary>How a terminal task ended, from the agent's point of view (spec 7.3).</summary>
public enum ResolutionKind
{
    Decided,
    Failed,
    Cancelled,
}

/// <param name="Kind">decided, failed or cancelled</param>
/// <param name="Record">the decision record; always present when decided, else maybe null</param>
/// <param name="Message">the server's status message for failed or cancelled, or null</param>
public sealed record Resolution(ResolutionKind Kind, DecisionRecord? Record, string? Message);

/// <summary>Interpreting decision records and terminal tasks (spec sections 6, 7.3).</summary>
public static class Decisions
{
    /// <summary>
    /// True only for an <c>approved</c> Approve decision. Any other terminal state,
    /// a timeout included, is not approval (rule R2). When the request carried a
    /// <c>payloadDigest</c>, the record must carry the same one (spec 4.2).
    /// </summary>
    public static bool IsApproved(DecisionRecord? record, string? requestPayloadDigest = null)
    {
        if (record == null || record.Primitive != "approve" || record.Outcome != "approved") return false;
        return VerifyPayloadDigest(record, requestPayloadDigest);
    }

    public static bool IsApproved(DecisionRecord? record, Request? request) => IsApproved(record, request?.PayloadDigest);

    public static bool IsApproved(DecisionRecord? record, Checkpoint? checkpoint) => IsApproved(record, checkpoint?.PayloadDigest);

    /// <summary>
    /// Checks that the record is bound to the payload the request sent. True when
    /// the request had no digest; false when it had one the record does not repeat.
    /// </summary>
    public static bool VerifyPayloadDigest(DecisionRecord record, string? requestPayloadDigest) =>
        requestPayloadDigest == null || requestPayloadDigest == record.PayloadDigest;

    public static bool VerifyPayloadDigest(DecisionRecord record, Request? request) =>
        VerifyPayloadDigest(record, request?.PayloadDigest);

    /// <summary>The answer of an <c>answered</c> Ask decision, or null for any other outcome.</summary>
    public static JsonNode? AnswerOf(DecisionRecord? record) =>
        record != null && record.Primitive == "ask" && record.Outcome == "answered" ? record.Answer : null;

    /// <summary><see cref="AnswerOf(DecisionRecord?)"/>, deserialized to the type the response schema promises.</summary>
    public static T? AnswerOf<T>(DecisionRecord? record)
    {
        var answer = AnswerOf(record);
        return answer == null ? default : answer.Deserialize<T>();
    }

    /// <summary>Interprets a terminal task. Throws <see cref="NotTerminalException"/> for a task that is still running.</summary>
    public static Resolution Resolve(HitlpTask task)
    {
        if (!task.Status.IsTerminal()) throw new NotTerminalException(task);
        if (task.Status == HitlpTaskStatus.Completed)
        {
            if (task.Result == null) throw new InvalidOperationException("task " + task.TaskId + " is completed without a decision record");
            return new Resolution(ResolutionKind.Decided, task.Result, null);
        }
        var kind = task.Status == HitlpTaskStatus.Failed ? ResolutionKind.Failed : ResolutionKind.Cancelled;
        return new Resolution(kind, task.Result, task.StatusMessage);
    }
}
