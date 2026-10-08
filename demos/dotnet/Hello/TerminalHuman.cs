using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Codefrak.Hitlp;

namespace Hello;

/// <summary>
/// The human's side of a HITLP server, shrunk to a terminal for the demo.
/// It only stores the task and turns what the person types into a decision
/// record; envelopes, validation, polling and deciding what a record means are the
/// SDK's. It is NOT a conforming HITLP server: its task store lives in memory (rule
/// R1), and its human is whoever sits at this terminal.
/// </summary>
public sealed class TerminalHuman : TaskTransport
{
    private sealed record Entry(HitlpTask Task, string Name, JsonObject Args);

    private readonly Func<string, string> _prompt;
    private readonly string _humanId;
    private readonly Dictionary<string, Entry> _tasks = new();
    private readonly Dictionary<string, string> _byKey = new();

    /// <param name="prompt">shows a question and returns the human's reply</param>
    public TerminalHuman(Func<string, string> prompt, string humanId = "terminal-human")
    {
        _prompt = prompt;
        _humanId = humanId;
    }

    /// <summary>Reads a reply from stdin, typed or piped.</summary>
    public static Func<string, string> TerminalPrompt() => question =>
    {
        Console.Write(question);
        Console.Out.Flush();
        var line = Console.ReadLine() ?? throw new InvalidOperationException("stdin closed before the human replied");
        return line.Trim();
    };

    /// <summary>Replays scripted replies (HITLP_DEMO_ANSWERS), echoing them as if typed.</summary>
    public static Func<string, string> ScriptedPrompt(IEnumerable<string> answers, Action<string> write)
    {
        var queue = new Queue<string>(answers);
        return question =>
        {
            if (queue.Count == 0) throw new InvalidOperationException("ran out of scripted answers");
            var reply = queue.Dequeue();
            write(question + reply);
            return reply;
        };
    }

    public override Task<HitlpTask> CallToolAsync(string name, JsonObject args, CancellationToken cancellationToken = default)
    {
        var key = args["idempotencyKey"]!.GetValue<string>();
        if (!_byKey.TryGetValue(key, out var id))
        {
            id = "task-" + (_tasks.Count + 1);
            _byKey[key] = id;
            _tasks[id] = new Entry(new HitlpTask(id, HitlpTaskStatus.Working, PollInterval: 10), name, args);
        }
        return Task.FromResult(_tasks[id].Task);
    }

    public override Task<HitlpTask> GetTaskAsync(string taskId, CancellationToken cancellationToken = default)
    {
        var e = _tasks[taskId];
        if (e.Task.Status == HitlpTaskStatus.Working)
        {
            e = e with { Task = e.Task with { Status = HitlpTaskStatus.Completed, Result = Decide(taskId, e.Name, e.Args) } };
            _tasks[taskId] = e;
        }
        return Task.FromResult(e.Task);
    }

    public override Task<HitlpTask> CancelTaskAsync(string taskId, CancellationToken cancellationToken = default)
    {
        var e = _tasks[taskId];
        if (e.Task.Status == HitlpTaskStatus.Working)
        {
            e = e with { Task = e.Task with { Status = HitlpTaskStatus.Cancelled } };
            _tasks[taskId] = e;
        }
        return Task.FromResult(e.Task);
    }

    private DecisionRecord Decide(string taskId, string name, JsonObject args)
    {
        var record = new JsonObject
        {
            ["requestId"] = taskId,
            ["idempotencyKey"] = args["idempotencyKey"]?.DeepClone(),
            ["decidedBy"] = new JsonObject { ["type"] = "human", ["id"] = _humanId },
            ["channel"] = "terminal",
        };
        if (name == Tools.AskTool)
        {
            var answer = _prompt("[human] " + args["question"] + " ");
            record["primitive"] = "ask";
            record["outcome"] = "answered";
            record["answer"] = answer;
            record["decidedAt"] = Hitlp.FormatDateTime(DateTimeOffset.UtcNow);
            return DecisionRecord.Of(record);
        }
        var reply = _prompt("[human] Approve \"" + args["action"] + "\" " + args["payload"]?.ToJsonString() + "? [y/N] ");
        var approved = Regex.IsMatch(reply, "^y(es)?$", RegexOptions.IgnoreCase);
        record["primitive"] = "approve";
        record["outcome"] = approved ? "approved" : "rejected";
        record["decidedAt"] = Hitlp.FormatDateTime(DateTimeOffset.UtcNow);
        if (!approved) record["reason"] = "declined at the terminal";
        if (args.ContainsKey("payloadDigest")) record["payloadDigest"] = args["payloadDigest"]?.DeepClone();
        return DecisionRecord.Of(record);
    }
}
