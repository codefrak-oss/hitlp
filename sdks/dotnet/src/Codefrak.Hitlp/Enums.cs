namespace Codefrak.Hitlp;

/// <summary>The v1 primitives (spec section 4).</summary>
public enum Primitive
{
    Ask,
    Approve,
}

/// <summary>
/// MCP Tasks statuses (spec 7.3). Named <c>HitlpTaskStatus</c> so it does not
/// clash with <see cref="System.Threading.Tasks.TaskStatus"/>.
/// </summary>
public enum HitlpTaskStatus
{
    Working,
    InputRequired,
    Completed,
    Failed,
    Cancelled,
}

/// <summary>The spec's schemas, vendored in <c>Schemas/</c> as embedded resources.</summary>
public enum SchemaName
{
    Envelope,
    DecisionRecord,
    AskRequest,
    AskResponse,
    ApproveRequest,
    ApproveResponse,
}

/// <summary>Wire values of the enums.</summary>
public static class Wire
{
    /// <summary>The value on the wire, e.g. <c>"ask"</c>.</summary>
    public static string ToWire(this Primitive p) => p switch
    {
        Primitive.Ask => "ask",
        Primitive.Approve => "approve",
        _ => throw new ArgumentOutOfRangeException(nameof(p)),
    };

    /// <summary>Parses a wire value; throws <see cref="ArgumentException"/> for anything else.</summary>
    public static Primitive ParsePrimitive(string? value) => value switch
    {
        "ask" => Primitive.Ask,
        "approve" => Primitive.Approve,
        _ => throw new ArgumentException("not a HITLP primitive: " + value),
    };

    public static string ToWire(this HitlpTaskStatus s) => s switch
    {
        HitlpTaskStatus.Working => "working",
        HitlpTaskStatus.InputRequired => "input_required",
        HitlpTaskStatus.Completed => "completed",
        HitlpTaskStatus.Failed => "failed",
        HitlpTaskStatus.Cancelled => "cancelled",
        _ => throw new ArgumentOutOfRangeException(nameof(s)),
    };

    public static HitlpTaskStatus ParseTaskStatus(string? value) => value switch
    {
        "working" => HitlpTaskStatus.Working,
        "input_required" => HitlpTaskStatus.InputRequired,
        "completed" => HitlpTaskStatus.Completed,
        "failed" => HitlpTaskStatus.Failed,
        "cancelled" => HitlpTaskStatus.Cancelled,
        _ => throw new ArgumentException("not an MCP task status: " + value),
    };

    /// <summary>True for <c>completed</c>, <c>failed</c> and <c>cancelled</c>.</summary>
    public static bool IsTerminal(this HitlpTaskStatus s) =>
        s is HitlpTaskStatus.Completed or HitlpTaskStatus.Failed or HitlpTaskStatus.Cancelled;

    /// <summary>The name the spec uses, e.g. <c>"ask.request"</c>.</summary>
    public static string Id(this SchemaName n) => n switch
    {
        SchemaName.Envelope => "envelope",
        SchemaName.DecisionRecord => "decision-record",
        SchemaName.AskRequest => "ask.request",
        SchemaName.AskResponse => "ask.response",
        SchemaName.ApproveRequest => "approve.request",
        SchemaName.ApproveResponse => "approve.response",
        _ => throw new ArgumentOutOfRangeException(nameof(n)),
    };

    public static SchemaName ParseSchemaName(string id) =>
        Enum.GetValues<SchemaName>().Cast<SchemaName?>().FirstOrDefault(n => n!.Value.Id() == id)
        ?? throw new ArgumentException("unknown schema " + id);
}
