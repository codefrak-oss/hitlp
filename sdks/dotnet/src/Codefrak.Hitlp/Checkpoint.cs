using System.Text.Json.Nodes;

namespace Codefrak.Hitlp;

/// <summary>
/// What an agent must store durably before it yields (rule R3): the task id and
/// the idempotency key, plus enough to check the result when it resumes.
/// </summary>
/// <param name="PayloadDigest">the request's payload digest, or null</param>
/// <param name="CreatedAt">an RFC 3339 date-time</param>
public sealed record Checkpoint(int Version, string TaskId, string IdempotencyKey, Primitive Primitive, string? PayloadDigest, string CreatedAt)
{
    public static Checkpoint ForTask(HitlpTask task, Request request, Primitive primitive, DateTimeOffset? now = null) =>
        new(1, task.TaskId,
            request.IdempotencyKey ?? throw new ArgumentException("request has no idempotencyKey"),
            primitive, request.PayloadDigest, Hitlp.FormatDateTime(now ?? DateTimeOffset.UtcNow));

    public string Serialize()
    {
        var o = new JsonObject
        {
            ["version"] = Version,
            ["taskId"] = TaskId,
            ["idempotencyKey"] = IdempotencyKey,
            ["primitive"] = Primitive.ToWire(),
        };
        if (PayloadDigest != null) o["payloadDigest"] = PayloadDigest;
        o["createdAt"] = CreatedAt;
        return o.ToJsonString();
    }

    /// <summary>Parses a serialized checkpoint; throws <see cref="ArgumentException"/> for anything else.</summary>
    public static Checkpoint Parse(string text)
    {
        JsonObject o;
        try
        {
            o = Json.ParseObject(text);
        }
        catch (ArgumentException e)
        {
            throw new ArgumentException("not a HITLP checkpoint", e);
        }
        var taskId = Json.GetString(o, "taskId");
        var key = Json.GetString(o, "idempotencyKey");
        var primitive = Json.GetString(o, "primitive");
        var createdAt = Json.GetString(o, "createdAt");
        var digest = o["payloadDigest"];
        var version = o["version"] is JsonValue v && v.TryGetValue<int>(out var n) ? n : 0;
        if (version != 1 || taskId == null || key == null || createdAt == null
            || primitive is not ("ask" or "approve")
            || (digest != null && Json.GetString(o, "payloadDigest") == null))
        {
            throw new ArgumentException("not a HITLP checkpoint");
        }
        return new Checkpoint(1, taskId, key, Wire.ParsePrimitive(primitive), Json.GetString(o, "payloadDigest"), createdAt);
    }
}
