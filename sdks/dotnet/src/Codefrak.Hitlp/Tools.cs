namespace Codefrak.Hitlp;

/// <summary>The v1 tool names (spec 7.1) and the reserved ones (spec section 4).</summary>
public static class Tools
{
    public const string AskTool = "human.ask";
    public const string ApproveTool = "human.approve";

    /// <summary>Reserved by the spec (section 4); never callable through this SDK.</summary>
    public static readonly IReadOnlyList<string> ReservedTools = new[] { "human.do", "human.inform", "human.escalate" };

    /// <summary>Throws <see cref="ReservedToolException"/> for a reserved name, and <see cref="ArgumentException"/> for any other non-v1 tool.</summary>
    public static void AssertCallableTool(string name)
    {
        if (ReservedTools.Contains(name)) throw new ReservedToolException(name);
        if (name != AskTool && name != ApproveTool) throw new ArgumentException(name + " is not a HITLP v1 tool");
    }
}
