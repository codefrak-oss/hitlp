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
        var requester = new JsonObject { ["agent"] = "hitlp-hello-dotnet" };

        // Ask: the call returns a task handle at once; the human answers later.
        log("[agent] Asking the human for their name (human.ask) ...");
        var ask = Ask.BuildAsk(new Ask.Input
        {
            Question = "What is your name?",
            ResponseSchema = new JsonObject { ["type"] = "string", ["minLength"] = 1 },
            Deadline = InAnHour(),
            DefaultOnTimeout = "cancel",
            Requester = requester,
        });
        var asked = await client.WaitForTerminalAsync(await client.AskAsync(ask));
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
            Requester = requester,
        });
        log("[agent] Requesting approval for " + approve.Action + " (human.approve) ...");
        var task = await client.ApproveAsync(approve);
        await File.WriteAllTextAsync(checkpointFile, Checkpoint.ForTask(task, approve, Primitive.Approve).Serialize());
        log("[agent] Checkpointed task " + task.TaskId + "; resuming from the checkpoint.");

        var resolution = await client.ResumeAsync(Checkpoint.Parse(await File.ReadAllTextAsync(checkpointFile)));
        File.Delete(checkpointFile);
        if (resolution.Kind == ResolutionKind.Decided && Decisions.IsApproved(resolution.Record, approve))
        {
            log("[agent] Approved by " + resolution.Record!.DecidedBy?["id"] + ". Deploying \"Hello, " + name + "!\" ... done.");
            return new Result(name, true);
        }
        var outcome = resolution.Record?.Outcome ?? resolution.Kind.ToString().ToLowerInvariant();
        log("[agent] Not approved (" + outcome + "); nothing deployed.");
        return new Result(name, false);
    }

    private static string InAnHour() => Hitlp.FormatDateTime(DateTimeOffset.UtcNow.AddHours(1));
}
