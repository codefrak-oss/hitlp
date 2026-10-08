using System.Text.Json.Nodes;

namespace Codefrak.Hitlp;

/// <summary>
/// Validated tool arguments: the envelope plus the primitive's body, flattened
/// (spec 7.1). Immutable; <see cref="ToJson"/> gives a fresh copy to send.
/// </summary>
public abstract class Request
{
    private readonly JsonObject _fields;

    private protected Request(JsonObject fields)
    {
        _fields = Json.Copy(fields);
    }

    public abstract Primitive Primitive { get; }

    public string? IdempotencyKey => Json.GetString(_fields, "idempotencyKey");

    public string? Deadline => Json.GetString(_fields, "deadline");

    public string? DefaultOnTimeout => Json.GetString(_fields, "defaultOnTimeout");

    /// <summary>The payload digest of an Approve request, or null.</summary>
    public string? PayloadDigest => Json.GetString(_fields, "payloadDigest");

    /// <summary>A copy of one top-level field, or null.</summary>
    public JsonNode? Get(string field) => _fields[field]?.DeepClone();

    /// <summary>A deep, mutable copy of the arguments.</summary>
    public JsonObject ToJson() => Json.Copy(_fields);

    public override string ToString() => _fields.ToJsonString();

    public override bool Equals(object? obj) =>
        obj is Request r && r.GetType() == GetType() && JsonNode.DeepEquals(r._fields, _fields);

    public override int GetHashCode() => _fields.ToJsonString().GetHashCode();
}

/// <summary><c>human.ask</c> arguments (spec 4.1, 7.1). Construct with <see cref="Of"/>, which validates.</summary>
public sealed class AskRequest : Request
{
    private AskRequest(JsonObject fields) : base(fields) { }

    /// <summary>Validates the arguments against <c>ask.request</c>; throws <see cref="HitlpValidationException"/>.</summary>
    public static AskRequest Of(JsonObject fields)
    {
        Validation.AssertValid(SchemaName.AskRequest, fields);
        return new AskRequest(fields);
    }

    public override Primitive Primitive => Primitive.Ask;

    public string? Question => Json.GetString(ToJson(), "question");
}

/// <summary><c>human.approve</c> arguments (spec 4.2, 7.1). Construct with <see cref="Of"/>, which validates.</summary>
public sealed class ApproveRequest : Request
{
    private ApproveRequest(JsonObject fields) : base(fields) { }

    /// <summary>Validates the arguments against <c>approve.request</c>; throws <see cref="HitlpValidationException"/>.</summary>
    public static ApproveRequest Of(JsonObject fields)
    {
        Validation.AssertValid(SchemaName.ApproveRequest, fields);
        return new ApproveRequest(fields);
    }

    public override Primitive Primitive => Primitive.Approve;

    public string? Action => Json.GetString(ToJson(), "action");

    public JsonObject? Payload => Get("payload") as JsonObject;
}
