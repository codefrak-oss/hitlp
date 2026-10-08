namespace Codefrak.Hitlp;

/// <summary>A request or decision record that its schema rejects.</summary>
public class HitlpValidationException : ArgumentException
{
    public HitlpValidationException(SchemaName schema, IReadOnlyList<string> errors)
        : base("invalid " + schema.Id() + ": " + string.Join("; ", errors))
    {
        Schema = schema;
        Errors = errors.ToArray();
    }

    public SchemaName Schema { get; }

    public IReadOnlyList<string> Errors { get; }
}

/// <summary>Thrown for <c>human.do</c>, <c>human.inform</c> and <c>human.escalate</c>.</summary>
public class ReservedToolException : ArgumentException
{
    public ReservedToolException(string name)
        : base(name + " is reserved by HITLP v1 and must not be called") { }
}

/// <summary><see cref="Decisions.Resolve"/> was given a task that is still running.</summary>
public class NotTerminalException : InvalidOperationException
{
    public NotTerminalException(HitlpTask task)
        : base("task " + task.TaskId + " is " + task.Status.ToWire() + ", not terminal") { }
}
