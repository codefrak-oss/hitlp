using System.Text.Json.Nodes;

namespace Codefrak.Hitlp;

/// <summary>Envelope fields a builder takes (spec section 5); the key and priority get defaults.</summary>
public class EnvelopeInput
{
    /// <summary>Defaults to a fresh key. Pass the stored key when re-building a retried request.</summary>
    public string? IdempotencyKey { get; set; }

    /// <summary>An RFC 3339 date-time; see <see cref="Hitlp.FormatDateTime"/>.</summary>
    public string? Deadline { get; set; }

    /// <summary><c>reject</c>, <c>escalate</c>, <c>cancel</c> or <c>fail</c>.</summary>
    public string? DefaultOnTimeout { get; set; }

    /// <summary><c>low</c>, <c>normal</c> (the default), <c>high</c> or <c>urgent</c>.</summary>
    public string? Priority { get; set; }

    /// <summary><c>{capabilities?, roles?}</c>.</summary>
    public JsonObject? Requires { get; set; }

    /// <summary><c>{summary?, links?, data?}</c>.</summary>
    public JsonObject? Context { get; set; }

    /// <summary><c>{agent?, onBehalfOf?}</c>.</summary>
    public JsonObject? Requester { get; set; }
}

/// <summary>The common request envelope (spec section 5).</summary>
public static class Envelope
{
    /// <summary>The envelope fields, with a fresh idempotency key and priority <c>normal</c> by default. Not validated.</summary>
    public static JsonObject BuildEnvelope(EnvelopeInput input)
    {
        var env = new JsonObject
        {
            ["idempotencyKey"] = input.IdempotencyKey ?? Idempotency.NewIdempotencyKey(),
            ["deadline"] = input.Deadline,
            ["defaultOnTimeout"] = input.DefaultOnTimeout,
            ["priority"] = input.Priority ?? "normal",
        };
        if (input.Requires != null) env["requires"] = input.Requires.DeepClone();
        if (input.Context != null) env["context"] = input.Context.DeepClone();
        if (input.Requester != null) env["requester"] = input.Requester.DeepClone();
        return env;
    }
}

/// <summary>The Ask primitive (spec 4.1).</summary>
public static class Ask
{
    public sealed class Input : EnvelopeInput
    {
        public string? Question { get; set; }

        /// <summary>JSON Schema for the answer (an object or a boolean). Free text must be asked for with <c>{"type": "string"}</c> (spec 4.1).</summary>
        public JsonNode? ResponseSchema { get; set; }

        /// <summary>Each <c>{value, label}</c>.</summary>
        public JsonArray? Options { get; set; }
    }

    /// <summary>Builds and validates <c>human.ask</c> arguments.</summary>
    public static AskRequest BuildAsk(Input input)
    {
        var req = Envelope.BuildEnvelope(input);
        req["question"] = input.Question;
        req["responseSchema"] = input.ResponseSchema?.DeepClone();
        if (input.Options != null) req["options"] = input.Options.DeepClone();
        return AskRequest.Of(req);
    }
}

/// <summary>The Approve primitive (spec 4.2).</summary>
public static class Approve
{
    public sealed class Input : EnvelopeInput
    {
        public string? Action { get; set; }

        public JsonObject? Payload { get; set; }

        public string? PayloadDigest { get; set; }

        /// <summary><c>{maxUses?, notAfter?}</c>.</summary>
        public JsonObject? Scope { get; set; }
    }

    /// <summary>Builds and validates <c>human.approve</c> arguments.</summary>
    public static ApproveRequest BuildApprove(Input input)
    {
        var req = Envelope.BuildEnvelope(input);
        // Defaults to reject, the spec's recommended default for Approve (section 5).
        if (input.DefaultOnTimeout == null) req["defaultOnTimeout"] = "reject";
        req["action"] = input.Action;
        req["payload"] = input.Payload?.DeepClone();
        if (input.PayloadDigest != null) req["payloadDigest"] = input.PayloadDigest;
        if (input.Scope != null) req["scope"] = input.Scope.DeepClone();
        return ApproveRequest.Of(req);
    }
}
