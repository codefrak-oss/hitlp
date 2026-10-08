# HITLP hello world: .NET

A HITLP (human-in-the-loop-protocol) agent on the .NET SDK, [`Codefrak.Hitlp`](../../sdks/dotnet/README.md). See [the demos index](../README.md) for what it does.

Needs the .NET 8 SDK; the SDK is built from `sdks/dotnet` through a project reference. From the repo root:

```sh
cd demos/dotnet
dotnet run --project Hello   # interactive: type your name, then y or n
```

Without typing:

```sh
HITLP_DEMO_ANSWERS=Ada,y dotnet run --project Hello   # approved: the greeting is deployed
HITLP_DEMO_ANSWERS=Ada,n dotnet run --project Hello   # rejected: nothing is deployed
dotnet test                                           # smoke tests of both paths
```

A run looks like this:

```
[agent] Asking the human for their name (human.ask) ...
[human] What is your name? Ada
[agent] Hello, Ada!
[agent] Requesting approval for deploy.greeting (human.approve) ...
[agent] Checkpointed task task-2; resuming from the checkpoint.
[human] Approve "deploy.greeting" {"greeting":"Hello, Ada!","target":"hello-world"}? [y/N] y
[agent] Approved by terminal-human. Deploying "Hello, Ada!" ... done.
```

- [Hello/HelloAgent.cs](Hello/HelloAgent.cs): the agent.
- [Hello/TerminalHuman.cs](Hello/TerminalHuman.cs): the demo-only transport that plays the human at the terminal.
- [Hello/Program.cs](Hello/Program.cs): the entry point, reading `HITLP_DEMO_ANSWERS`.
- [Hello.Tests/HelloTest.cs](Hello.Tests/HelloTest.cs): the smoke tests.
