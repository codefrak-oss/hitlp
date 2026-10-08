using Xunit;

namespace Hello.Tests;

/// <summary>Smoke tests: run the demo with scripted answers, as HITLP_DEMO_ANSWERS does.</summary>
public sealed class HelloTest : IDisposable
{
    private readonly string _tmp = Directory.CreateTempSubdirectory("hitlp-hello-").FullName;
    private readonly List<string> _lines = new();

    private string CheckpointFile => Path.Combine(_tmp, "cp.json");

    private Task<HelloAgent.Result> Run(params string[] answers) =>
        HelloAgent.RunAsync(TerminalHuman.ScriptedPrompt(answers, _lines.Add), _lines.Add, CheckpointFile);

    public void Dispose() => Directory.Delete(_tmp, true);

    [Fact]
    public async Task GreetsAndDeploysOnceApproved()
    {
        Assert.Equal(new HelloAgent.Result("Ada", true), await Run("Ada", "y"));
        Assert.Contains("[agent] Hello, Ada!", _lines);
        Assert.Contains("[agent] Approved by terminal-human. Deploying \"Hello, Ada!\" ... done.", _lines);
        Assert.False(File.Exists(CheckpointFile));
    }

    [Fact]
    public async Task DoesNotDeployWhenRejected()
    {
        Assert.Equal(new HelloAgent.Result("Ada", false), await Run("Ada", "n"));
        Assert.Contains("[agent] Not approved (rejected); nothing deployed.", _lines);
    }
}
