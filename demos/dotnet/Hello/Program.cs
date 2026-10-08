using Hello;

var scripted = Environment.GetEnvironmentVariable("HITLP_DEMO_ANSWERS");
var prompt = scripted != null
    ? TerminalHuman.ScriptedPrompt(scripted.Split(','), Console.WriteLine)
    : TerminalHuman.TerminalPrompt();
await HelloAgent.RunAsync(prompt, Console.WriteLine, ".hitlp-demo-checkpoint.json");
