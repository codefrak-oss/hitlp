using System.Text.Json.Nodes;
using Xunit;

namespace Codefrak.Hitlp.Tests;

public class BuildersTest
{
    [Fact]
    public void BuildAskProducesFlatHumanAskArgumentsWithEnvelopeDefaults()
    {
        var req = Ask.BuildAsk(new Ask.Input
        {
            IdempotencyKey = "inv-993-currency",
            Deadline = Hitlp.FormatDateTime(DateTimeOffset.Parse("2026-10-09T09:00:00Z")),
            DefaultOnTimeout = "escalate",
            Requires = new JsonObject { ["capabilities"] = new JsonArray("finance.invoice") },
            Question = "Which currency is invoice 993 in?",
            ResponseSchema = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray("EUR", "USD", "GBP") },
        });
        var want = JsonNode.Parse("""
            {"idempotencyKey":"inv-993-currency","deadline":"2026-10-09T09:00:00Z","defaultOnTimeout":"escalate",
             "priority":"normal","requires":{"capabilities":["finance.invoice"]},
             "question":"Which currency is invoice 993 in?","responseSchema":{"type":"string","enum":["EUR","USD","GBP"]}}
            """);
        Assert.True(JsonNode.DeepEquals(want, req.ToJson()), req.ToString());
        Assert.True(Validation.Validate("ask.request", req).Valid);
    }

    [Fact]
    public void BuildApproveDefaultsDefaultOnTimeoutToRejectAndMintsAKey()
    {
        var req = Approve.BuildApprove(new Approve.Input
        {
            Deadline = "2026-10-15T12:00:00Z",
            Action = "Deploy release 4.21 to production",
            Payload = new JsonObject { ["service"] = "billing", ["version"] = "4.21.0" },
            PayloadDigest = "sha256:9f2c1e0a",
            Scope = new JsonObject { ["maxUses"] = 1, ["notAfter"] = "2026-10-16T00:00:00Z" },
        });
        Assert.Equal("reject", req.DefaultOnTimeout);
        Assert.False(string.IsNullOrEmpty(req.IdempotencyKey));
        Assert.True(Validation.Validate(SchemaName.ApproveRequest, req).Valid);
    }

    [Fact]
    public void BuildEnvelopeGivesAValidEnvelope()
    {
        var env = Envelope.BuildEnvelope(new EnvelopeInput { Deadline = "2026-10-15T12:00:00Z", DefaultOnTimeout = "fail" });
        Assert.True(Validation.Validate(SchemaName.Envelope, env).Valid);
    }

    [Fact]
    public void BuildersRefuseRequestsTheSchemaRejects()
    {
        Assert.Throws<HitlpValidationException>(() => Ask.BuildAsk(new Ask.Input
        {
            Deadline = "soon", DefaultOnTimeout = "fail", Question = "q", ResponseSchema = new JsonObject { ["type"] = "string" },
        }));
        Assert.Throws<HitlpValidationException>(() => Approve.BuildApprove(new Approve.Input
        {
            Deadline = "2026-10-15T12:00:00Z", Action = "", Payload = new JsonObject(),
        }));
    }

    [Fact]
    public void EachNewRequestGetsAFreshIdempotencyKey()
    {
        var input = new Approve.Input { Deadline = "2026-10-15T12:00:00Z", Action = "x", Payload = new JsonObject() };
        Assert.NotEqual(Approve.BuildApprove(input).IdempotencyKey, Approve.BuildApprove(input).IdempotencyKey);
        Assert.StartsWith("inv-", Idempotency.NewIdempotencyKey("inv"));
    }
}
