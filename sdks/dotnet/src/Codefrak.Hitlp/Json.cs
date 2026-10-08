using System.Text.Json;
using System.Text.Json.Nodes;

namespace Codefrak.Hitlp;

/// <summary>JSON plumbing shared by the SDK: plain <see cref="JsonNode"/> values in and out.</summary>
internal static class Json
{
    internal static JsonObject Copy(JsonObject value) => (JsonObject)value.DeepClone();

    internal static JsonObject ParseObject(string text)
    {
        try
        {
            return JsonNode.Parse(text) as JsonObject ?? throw new ArgumentException("not a JSON object");
        }
        catch (JsonException e)
        {
            throw new ArgumentException("not a JSON object: " + e.Message, e);
        }
    }

    internal static string? GetString(JsonObject o, string field) =>
        o[field] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}
