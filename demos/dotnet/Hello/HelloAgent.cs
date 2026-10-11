using System.Text.Json;
using System.Text.Json.Nodes;
using Codefrak.Hitlp;

namespace Hello;

/// <summary>
/// A hello world HITLP (human-in-the-loop-protocol) agent on the .NET SDK.
/// It asks the human their name (Ask), greets them, then asks approval to deploy
/// a greeting (Approve) and goes on only if approved.
/// </summary>
public static class HelloAgent
{
    public sealed record Result(string? Name, bool Deployed);

    public static async Task<Result> RunAsync(Func<string, string> prompt, Action<string> log, string checkpointFile)
    {
        var client = new HitlpClient(new TerminalHuman(prompt));
        // The server learns who asks from the credentials (0.2 attested); the agent only says why.
        var asserted = new JsonObject { ["why"] = "the hello demo greets the person and asks before deploying" };

        // Ask: the call returns a task handle at once; the human answers later.
        log("[agent] Asking the human for their name (human.ask) ...");
        var ask = Ask.BuildAsk(new Ask.Input
        {
            Question = "What is your name?",
            ResponseSchema = new JsonObject { ["type"] = "string", ["minLength"] = 1 },
            Deadline = InAnHour(),
            DefaultOnTimeout = "cancel",
            Asserted = asserted,
        });
        Wire(log, "-> human.ask arguments", ask.ToJson());
        var askTask = await client.AskAsync(ask);
        Wire(log, "<- task handle", TaskJson(askTask));
        var asked = await client.WaitForTerminalAsync(askTask);
        Wire(log, "<- tasks/get " + asked.TaskId + " (terminal)", TaskJson(asked));
        var name = Decisions.AnswerOf<string>(asked.Result);
        if (string.IsNullOrEmpty(name))
        {
            log("[agent] No answer (" + asked.Status.ToWire() + "); stopping.");
            return new Result(null, false);
        }
        log("[agent] Hello, " + name + "!");

        // Approve: checkpoint the handle before yielding (rule R3), then resume from it.
        var approve = Approve.BuildApprove(new Approve.Input
        {
            Action = "deploy.greeting",
            Payload = new JsonObject { ["greeting"] = "Hello, " + name + "!", ["target"] = "hello-world" },
            Deadline = InAnHour(),
            Asserted = asserted,
        });
        log("[agent] Requesting approval for " + approve.Action + " (human.approve) ...");
        Wire(log, "-> human.approve arguments", approve.ToJson());
        var task = await client.ApproveAsync(approve);
        Wire(log, "<- task handle", TaskJson(task));
        var checkpoint = Checkpoint.ForTask(task, approve, Primitive.Approve).Serialize();
        await File.WriteAllTextAsync(checkpointFile, checkpoint);
        log("[agent] Checkpointed task " + task.TaskId + "; resuming from the checkpoint.");
        Wire(log, "   checkpoint", JsonNode.Parse(checkpoint)!);

        var resolution = await client.ResumeAsync(Checkpoint.Parse(await File.ReadAllTextAsync(checkpointFile)));
        File.Delete(checkpointFile);
        Wire(log, "<- tasks/get " + task.TaskId + " (terminal) resolved as " + resolution.Kind.ToString().ToLowerInvariant(),
            resolution.Record?.ToJson() ?? new JsonObject { ["message"] = resolution.Message });
        if (resolution.Kind == ResolutionKind.Decided && Decisions.IsApproved(resolution.Record, approve))
        {
            log("[agent] Approved by " + resolution.Record!.DecidedBy?["id"] + ". Deploying \"Hello, " + name + "!\" ... done.");
            return new Result(name, true);
        }
        var outcome = resolution.Record?.Outcome ?? resolution.Kind.ToString().ToLowerInvariant();
        log("[agent] Not approved (" + outcome + "); nothing deployed.");
        return new Result(name, false);
    }

    private static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true };

    /// <summary>Prints the fields of one protocol message, indented, under a [wire] label.</summary>
    private static void Wire(Action<string> log, string label, JsonNode json)
    {
        log("[wire] " + label);
        foreach (var line in json.ToJsonString(Pretty).Split('\n'))
        {
            log("       " + line);
        }
    }

    /// <summary>The task handle as the transport reported it (spec 7.2), without nulls.</summary>
    private static JsonObject TaskJson(HitlpTask task)
    {
        var o = new JsonObject { ["taskId"] = task.TaskId, ["status"] = task.Status.ToWire() };
        if (task.Ttl != null) o["ttl"] = task.Ttl;
        if (task.PollInterval != null) o["pollInterval"] = task.PollInterval;
        if (task.StatusMessage != null) o["statusMessage"] = task.StatusMessage;
        if (task.Meta != null) o["_meta"] = JsonNode.Parse(task.Meta.Value.GetRawText());
        if (task.Result != null) o["result"] = task.Result.ToJson();
        return o;
    }

    private static string InAnHour() => Hitlp.FormatDateTime(DateTimeOffset.UtcNow.AddHours(1));
}
