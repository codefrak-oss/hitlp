using System.Text.Json.Nodes;
using Codefrak.Hitlp.Testing;
using Xunit;

namespace Codefrak.Hitlp.Tests;

public class ClientTest
{
    private readonly List<TimeSpan> _slept = new();

    private HitlpClientOptions FakeSleep() => new()
    {
        Delay = (d, _) =>
        {
            _slept.Add(d);
            return Task.CompletedTask;
        },
    };

    private static AskRequest NewAsk() => Ask.BuildAsk(new Ask.Input
    {
        Deadline = "2026-10-09T09:00:00Z", DefaultOnTimeout = "reject",
        Question = "Which currency?", ResponseSchema = new JsonObject { ["type"] = "string" },
    });

    private static ApproveRequest NewApprove() => Approve.BuildApprove(new Approve.Input
    {
        Deadline = "2026-10-15T12:00:00Z", Action = "deploy", Payload = new JsonObject { ["v"] = 1 }, PayloadDigest = "sha256:aa",
    });

    private static JsonObject Record(string? key, string primitive, string outcome, JsonObject? extra = null)
    {
        var r = new JsonObject
        {
            ["idempotencyKey"] = key, ["primitive"] = primitive, ["outcome"] = outcome,
            ["decidedBy"] = new JsonObject { ["type"] = "human", ["id"] = "h1" }, ["decidedAt"] = "2026-10-08T15:20:00Z",
        };
        if (extra != null) foreach (var (k, v) in extra) r[k] = v?.DeepClone();
        return r;
    }

    private static JsonObject Answer(string answer) => new() { ["answer"] = answer };

    private sealed class Hooked(long? pollInterval, Action<FakeTransport, string> onGet) : FakeTransport(pollInterval)
    {
        public override Task<HitlpTask> GetTaskAsync(string taskId, CancellationToken cancellationToken = default)
        {
            onGet(this, taskId);
            return base.GetTaskAsync(taskId, cancellationToken);
        }
    }

    [Fact]
    public async Task AskReturnsTheTaskHandleAtOnceWithoutWaiting()
    {
        var t = new FakeTransport();
        var task = await new HitlpClient(t).AskAsync(NewAsk());
        Assert.Equal(HitlpTaskStatus.Working, task.Status);
        Assert.Equal("human.ask", t.Calls[0].Name);
        Assert.Empty(t.Gets);
    }

    [Fact]
    public async Task WaitForTerminalNeverPollsFasterThanPollInterval()
    {
        var req = NewAsk();
        var polls = 0;
        var t = new Hooked(750, (f, id) =>
        {
            if (++polls == 3) f.Complete(id, Record(req.IdempotencyKey, "ask", "answered", Answer("EUR")));
        });
        var client = new HitlpClient(t, FakeSleep());
        var done = await client.WaitForTerminalAsync(await client.AskAsync(req));
        Assert.Equal(HitlpTaskStatus.Completed, done.Status);
        Assert.Equal("EUR", Decisions.AnswerOf<string>(done.Result));
        Assert.Equal(new[] { 750, 750, 750 }.Select(ms => TimeSpan.FromMilliseconds(ms)), _slept);
    }

    [Fact]
    public async Task WaitForTerminalUsesTheDefaultIntervalWhenTheServerGivesNone()
    {
        var req = NewAsk();
        var t = new Hooked(null, (f, id) => f.Complete(id, Record(req.IdempotencyKey, "ask", "answered", Answer("EUR"))));
        var options = FakeSleep();
        options.DefaultPollInterval = TimeSpan.FromSeconds(2);
        var client = new HitlpClient(t, options);
        await client.WaitForTerminalAsync(await client.AskAsync(req));
        Assert.Equal(new[] { TimeSpan.FromSeconds(2) }, _slept);
    }

    [Fact]
    public async Task WaitForTerminalHonoursAnAlreadyCancelledToken()
    {
        var client = new HitlpClient(new FakeTransport(), FakeSleep());
        var task = await client.AskAsync(NewAsk());
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.WaitForTerminalAsync(task with { PollInterval = null }, null, cts.Token));
    }

    [Fact(Timeout = 5000)]
    public async Task CancellingTheTokenWakesARealSleep()
    {
        var client = new HitlpClient(new FakeTransport(60_000));
        var task = await client.AskAsync(NewAsk());
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => client.WaitForTerminalAsync(task, null, cts.Token));
    }

    [Fact]
    public async Task InputRequiredIsReportedAndPollingGoesOn()
    {
        var req = NewAsk();
        var t = new FakeTransport();
        var client = new HitlpClient(t, new HitlpClientOptions
        {
            Delay = (_, _) =>
            {
                t.Complete("task-1", Record(req.IdempotencyKey, "ask", "answered", Answer("EUR")));
                return Task.CompletedTask;
            },
        });
        var task = await client.AskAsync(req);
        t.SetStatus(task.TaskId, HitlpTaskStatus.InputRequired, "needs a human");
        var seen = new List<HitlpTask>();
        var done = await client.WaitForTerminalAsync(task.TaskId, new WaitOptions { OnInputRequired = seen.Add });
        Assert.Single(seen);
        Assert.Equal(HitlpTaskStatus.Completed, done.Status);
    }

    [Fact]
    public async Task WaitForTerminalReachesEachTerminalStatus()
    {
        foreach (var status in new[] { HitlpTaskStatus.Failed, HitlpTaskStatus.Cancelled })
        {
            var t = new FakeTransport();
            var client = new HitlpClient(t, FakeSleep());
            var task = await client.ApproveAsync(NewApprove());
            t.SetStatus(task.TaskId, status, "ended");
            var done = await client.WaitForTerminalAsync(task);
            Assert.Equal(status, done.Status);
            var res = Decisions.Resolve(done);
            Assert.Equal(status == HitlpTaskStatus.Failed ? ResolutionKind.Failed : ResolutionKind.Cancelled, res.Kind);
            Assert.Equal("ended", res.Message);
            Assert.False(Decisions.IsApproved(res.Record));
        }
    }

    [Fact]
    public async Task CancelGoesThroughTasksCancel()
    {
        var t = new FakeTransport();
        var client = new HitlpClient(t);
        var task = await client.ApproveAsync(NewApprove());
        var after = await client.CancelAsync(task.TaskId);
        Assert.Equal(new[] { task.TaskId }, t.Cancels);
        Assert.Equal(HitlpTaskStatus.Cancelled, after.Status);
        Assert.Equal(ResolutionKind.Cancelled, Decisions.Resolve(after).Kind);
    }

    [Fact]
    public async Task ARetriedCallSendsTheSameIdempotencyKeyAndGetsTheSameHandle()
    {
        var t = new FakeTransport { FailNextCalls = 1 };
        var client = new HitlpClient(t);
        var req = NewApprove();
        var task = await client.ApproveAsync(req);
        Assert.Equal(2, t.Calls.Count);
        Assert.Equal(req.IdempotencyKey, t.Calls[0].Args["idempotencyKey"]!.GetValue<string>());
        Assert.Equal(req.IdempotencyKey, t.Calls[1].Args["idempotencyKey"]!.GetValue<string>());
        Assert.Equal("task-1", task.TaskId);
        var other = await client.ApproveAsync(NewApprove());
        Assert.NotEqual(req.IdempotencyKey, t.Calls[2].Args["idempotencyKey"]!.GetValue<string>());
        Assert.NotEqual(task.TaskId, other.TaskId);
    }

    [Fact]
    public async Task RetriesGiveUpAfterCallRetries()
    {
        var t = new FakeTransport { FailNextCalls = 5 };
        var client = new HitlpClient(t, new HitlpClientOptions { CallRetries = 1 });
        await Assert.ThrowsAsync<InvalidOperationException>(() => client.AskAsync(NewAsk()));
        Assert.Equal(2, t.Calls.Count);
    }

    [Fact]
    public async Task CheckpointRoundTripThenResumeFromTheStoredTaskId()
    {
        var t = new FakeTransport();
        var req = NewApprove();
        var task = await new HitlpClient(t).ApproveAsync(req);
        var stored = Checkpoint.ForTask(task, req, Primitive.Approve).Serialize();

        // A new process: only the checkpoint survives.
        var cp = Checkpoint.Parse(stored);
        Assert.Equal(task.TaskId, cp.TaskId);
        Assert.Equal(req.IdempotencyKey, cp.IdempotencyKey);
        t.Complete(cp.TaskId, Record(cp.IdempotencyKey, "approve", "approved", new JsonObject { ["payloadDigest"] = "sha256:aa" }));
        var res = await new HitlpClient(t, FakeSleep()).ResumeAsync(cp);
        Assert.Equal(ResolutionKind.Decided, res.Kind);
        Assert.True(Decisions.IsApproved(res.Record, cp));
        Assert.Throws<ArgumentException>(() => Checkpoint.Parse("{}"));
        Assert.Throws<ArgumentException>(() => Checkpoint.Parse("not json"));
    }

    [Fact]
    public async Task ResumeRefusesATaskThatDoesNotMatchItsCheckpoint()
    {
        var t = new FakeTransport();
        var req = NewApprove();
        var task = await new HitlpClient(t).ApproveAsync(req);
        var cp = Checkpoint.ForTask(task, req, Primitive.Approve);
        t.Complete(cp.TaskId, Record("other-key", "approve", "approved", new JsonObject { ["payloadDigest"] = "sha256:aa" }));
        await Assert.ThrowsAsync<InvalidOperationException>(() => new HitlpClient(t).ResumeAsync(cp));
    }

    private static readonly DecisionRecord Base = DecisionRecord.Of((JsonObject)JsonNode.Parse("""
        {"requestId":"t","idempotencyKey":"k","primitive":"approve","outcome":"approved",
         "decidedBy":{"type":"human","id":"h"},"decidedAt":"2026-10-08T18:04:11Z","payloadDigest":"sha256:aa"}
        """)!);

    private static DecisionRecord With(DecisionRecord r, string field, JsonNode? value)
    {
        var m = r.ToJson();
        if (value == null) m.Remove(field);
        else m[field] = value;
        return DecisionRecord.Of(m);
    }

    [Fact]
    public void OnlyAnApprovedOutcomeIsApprovalTimeoutsNeverAre()
    {
        Assert.True(Decisions.IsApproved(Base));
        foreach (var outcome in new[] { "rejected", "timed_out", "cancelled" })
        {
            var r = With(With(Base, "outcome", outcome), "decidedBy", new JsonObject { ["type"] = "policy" });
            Assert.False(Decisions.IsApproved(r), outcome);
        }
        Assert.False(Decisions.IsApproved(null));
        Assert.False(Decisions.IsApproved(With(Base, "primitive", "ask")));
        var failed = Decisions.Resolve(new HitlpTask("t", HitlpTaskStatus.Failed, StatusMessage: "default fail"));
        Assert.Equal(ResolutionKind.Failed, failed.Kind);
        Assert.Equal("default fail", failed.Message);
        Assert.Throws<NotTerminalException>(() => Decisions.Resolve(new HitlpTask("t", HitlpTaskStatus.Working)));
    }

    [Fact]
    public void APayloadDigestMismatchIsFlagged()
    {
        Assert.True(Decisions.VerifyPayloadDigest(Base, "sha256:aa"));
        Assert.False(Decisions.VerifyPayloadDigest(With(Base, "payloadDigest", "sha256:bb"), "sha256:aa"));
        Assert.False(Decisions.VerifyPayloadDigest(With(Base, "payloadDigest", null), "sha256:aa"));
        Assert.False(Decisions.IsApproved(With(Base, "payloadDigest", "sha256:bb"), "sha256:aa"));
        Assert.False(Decisions.IsApproved(With(Base, "payloadDigest", "sha256:bb"), NewApprove()));
    }

    [Fact]
    public void AnswerOfIsNullForAnythingButAnAnsweredAsk()
    {
        Assert.Null(Decisions.AnswerOf(Base));
        Assert.Null(Decisions.AnswerOf(null));
    }

    [Fact]
    public async Task AnInvalidDecisionRecordFromTheServerIsRefused()
    {
        var t = new FakeTransport();
        var client = new HitlpClient(t, FakeSleep());
        var req = NewAsk();
        var task = await client.AskAsync(req);
        var r = Record(req.IdempotencyKey, "ask", "timed_out");
        r["decidedBy"] = new JsonObject { ["type"] = "human" };
        t.Complete(task.TaskId, r);
        var e = await Assert.ThrowsAsync<HitlpValidationException>(() => client.WaitForTerminalAsync(task.TaskId));
        Assert.StartsWith("invalid ask.response", e.Message);
    }

    [Fact]
    public void ReservedToolNamesAreNotCallable()
    {
        foreach (var name in new[] { "human.do", "human.inform", "human.escalate" })
        {
            Assert.Throws<ReservedToolException>(() => Tools.AssertCallableTool(name));
        }
        Assert.Throws<ArgumentException>(() => Tools.AssertCallableTool("human.other"));
        Tools.AssertCallableTool("human.ask");
    }

    private const string Url = "https://example.test/d/1";

    [Fact]
    public void DecisionUrlReadsMetaOnlyWhenAString()
    {
        static System.Text.Json.JsonElement Meta(string json) => System.Text.Json.JsonDocument.Parse(json).RootElement.Clone();
        var withUrl = new HitlpTask("t", HitlpTaskStatus.InputRequired, Meta: Meta("{\"io.hitlp/decisionUrl\":\"https://example.test/d/1\"}"));
        Assert.Equal(Url, withUrl.DecisionUrl);
        var none = new HitlpTask("t", HitlpTaskStatus.Working);
        Assert.Null(none.Meta);
        Assert.Null(none.DecisionUrl);
        Assert.Null((none with { Meta = Meta("{\"io.hitlp/decisionUrl\":42}") }).DecisionUrl);
    }

    /// <summary>Applies one status of <paramref name="script"/> before each poll; returns the callback's tasks and poll counts.</summary>
    private async Task<List<(HitlpTask Task, int Polls)>> Drive(string[] script, bool startInputRequired)
    {
        var req = NewAsk();
        var polls = 0;
        void Apply(FakeTransport f, string id, string s)
        {
            if (s == "completed")
            {
                f.Complete(id, Record(req.IdempotencyKey, "ask", "answered", Answer("EUR")));
                return;
            }
            var input = s == "input_required";
            f.SetStatus(id, input ? HitlpTaskStatus.InputRequired : HitlpTaskStatus.Working);
            f.SetMeta(id, input ? new JsonObject { ["io.hitlp/decisionUrl"] = Url } : null);
        }
        var t = new Hooked(500, (f, id) => Apply(f, id, polls < script.Length ? script[polls++] : "completed"));
        var client = new HitlpClient(t, FakeSleep());
        var task = await client.AskAsync(req);
        if (startInputRequired)
        {
            Apply(t, task.TaskId, "input_required");
            task = task with
            {
                Status = HitlpTaskStatus.InputRequired,
                Meta = System.Text.Json.JsonDocument.Parse("{\"io.hitlp/decisionUrl\":\"" + Url + "\"}").RootElement.Clone(),
            };
        }
        var seen = new List<(HitlpTask, int)>();
        var done = await client.WaitForTerminalAsync(task, new WaitOptions { OnInputRequired = x => seen.Add((x, polls)) });
        Assert.Equal(HitlpTaskStatus.Completed, done.Status);
        return seen;
    }

    [Fact]
    public async Task OnInputRequiredFiresOncePerEntry()
    {
        var seen = await Drive(new[] { "working", "input_required", "input_required", "input_required", "completed" }, false);
        Assert.Single(seen);
        Assert.Equal(Url, seen[0].Task.DecisionUrl);
    }

    [Fact]
    public async Task OnInputRequiredFiresAgainAfterReEntry()
    {
        var seen = await Drive(new[] { "input_required", "input_required", "working", "input_required", "completed" }, false);
        Assert.Equal(2, seen.Count);
        Assert.All(seen, s => Assert.Equal(Url, s.Task.DecisionUrl));
    }

    [Fact]
    public async Task OnInputRequiredFiresBeforeTheFirstRepollWhenStartingInputRequired()
    {
        var seen = await Drive(new[] { "input_required", "completed" }, true);
        Assert.Single(seen);
        Assert.Equal(0, seen[0].Polls);
        Assert.Equal(Url, seen[0].Task.DecisionUrl);
    }
}
