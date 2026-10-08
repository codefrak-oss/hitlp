using System.Reflection;
using System.Text.Json.Nodes;
using Json.Schema;

namespace Codefrak.Hitlp;

/// <summary>The outcome of <see cref="Validation.Validate(SchemaName, object?)"/>.</summary>
public sealed record ValidationResult(bool Valid, IReadOnlyList<string> Errors);

/// <summary>
/// Validation against the spec's JSON schemas (2020-12, formats asserted), vendored
/// from spec/schemas by sdks/scripts/sync-schemas.mjs.
/// </summary>
public static class Validation
{
    private const string Id = "https://github.com/codefrak-oss/hitlp/spec/schemas/";
    private static readonly Dictionary<SchemaName, JsonSchema> Schemas = Load();

    private static Dictionary<SchemaName, JsonSchema> Load()
    {
        var asm = typeof(Validation).Assembly;
        var schemas = new Dictionary<SchemaName, JsonSchema>();
        foreach (var name in Enum.GetValues<SchemaName>())
        {
            using var stream = asm.GetManifestResourceStream("Codefrak.Hitlp.Schemas." + name.Id() + ".schema.json")
                ?? throw new InvalidOperationException("schema " + name.Id() + " is not embedded");
            using var reader = new StreamReader(stream);
            var schema = JsonSchema.FromText(reader.ReadToEnd());
            schemas[name] = schema;
        }
        return schemas;
    }

    private static EvaluationOptions Options()
    {
        var options = new EvaluationOptions { OutputFormat = OutputFormat.List, RequireFormatValidation = true };
        // Resolves the schemas' relative $refs by their $id, without touching SchemaRegistry.Global.
        foreach (var (name, schema) in Schemas) options.SchemaRegistry.Register(new Uri(Id + name.Id() + ".schema.json"), schema);
        return options;
    }

    /// <summary>Validates a value (a <see cref="JsonNode"/>, a <see cref="Request"/> or a <see cref="DecisionRecord"/>) against one of the spec's schemas.</summary>
    public static ValidationResult Validate(SchemaName schema, object? value)
    {
        JsonNode? node = value switch
        {
            Request r => r.ToJson(),
            DecisionRecord d => d.ToJson(),
            JsonNode n => n,
            null => null,
            _ => throw new ArgumentException("not a JSON value: " + value.GetType()),
        };
        var results = Schemas[schema].Evaluate(node, Options());
        var errors = results.Details
            .Where(d => d.Errors != null)
            .SelectMany(d => d.Errors!.Select(e => d.InstanceLocation + ": " + e.Value))
            .Order(StringComparer.Ordinal)
            .ToList();
        if (!results.IsValid && errors.Count == 0) errors.Add("invalid");
        return new ValidationResult(results.IsValid, errors);
    }

    /// <summary>Validates against the schema the spec names, e.g. <c>"ask.request"</c>.</summary>
    public static ValidationResult Validate(string schema, object? value) => Validate(Wire.ParseSchemaName(schema), value);

    /// <summary>Throws <see cref="HitlpValidationException"/> unless the value is valid.</summary>
    public static void AssertValid(SchemaName schema, object? value)
    {
        var r = Validate(schema, value);
        if (!r.Valid) throw new HitlpValidationException(schema, r.Errors);
    }
}
