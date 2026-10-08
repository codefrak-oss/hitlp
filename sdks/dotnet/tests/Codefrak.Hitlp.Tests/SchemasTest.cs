using System.Text.Json.Nodes;
using Xunit;

namespace Codefrak.Hitlp.Tests;

public class SchemasTest
{
    // Examples/ is vendored from spec/examples and embedded in this assembly.
    private static JsonObject Load(string file)
    {
        using var stream = typeof(SchemasTest).Assembly.GetManifestResourceStream("Examples." + file)
            ?? throw new InvalidOperationException("no example " + file);
        return (JsonObject)JsonNode.Parse(stream)!;
    }

    [Theory]
    [InlineData("ask.request.json", "ask.request")]
    [InlineData("ask.response.json", "ask.response")]
    [InlineData("approve.request.json", "approve.request")]
    [InlineData("approve.response.json", "approve.response")]
    public void SpecExampleValidates(string file, string schema)
    {
        var r = Validation.Validate(schema, Load(file));
        Assert.True(r.Valid, string.Join("; ", r.Errors));
    }

    private static readonly Dictionary<string, (string Schema, Action<JsonObject> Mutate)> Invalid = new()
    {
        ["missing deadline"] = ("ask.request", v => v.Remove("deadline")),
        ["bad defaultOnTimeout"] = ("approve.request", v => v["defaultOnTimeout"] = "approve"),
        ["deadline not a date-time"] = ("approve.request", v => v["deadline"] = "tomorrow"),
        ["context link not a uri"] = ("approve.request", v => v["context"] = new JsonObject { ["links"] = new JsonArray("not a uri") }),
        ["ask without responseSchema"] = ("ask.request", v => v.Remove("responseSchema")),
        ["answered without answer"] = ("ask.response", v => v.Remove("answer")),
        ["timed_out decided by a human"] = ("ask.response", v =>
        {
            v["outcome"] = "timed_out";
            v.Remove("answer");
        }),
        ["approve result with an answer"] = ("approve.response", v => v["answer"] = "yes"),
        ["ask result with outcome approved"] = ("ask.response", v => v["outcome"] = "approved"),
    };

    public static IEnumerable<object[]> InvalidNames() => Invalid.Keys.Select(k => new object[] { k });

    [Theory]
    [MemberData(nameof(InvalidNames))]
    public void Rejects(string name)
    {
        var (schema, mutate) = Invalid[name];
        var v = Load(schema + ".json");
        mutate(v);
        Assert.False(Validation.Validate(schema, v).Valid);
    }

    [Fact]
    public void UnknownSchemaIsAnError()
    {
        Assert.Throws<ArgumentException>(() => Validation.Validate("nope", new JsonObject()));
    }
}
