# HITLP hello world: Java

A HITLP (human-in-the-loop-protocol) agent on the Java SDK, [`org.codefrak:hitlp`](../../sdks/java/README.md). See [the demos index](../README.md) for what it does.

Needs Java 17 or later; Gradle comes through the wrapper, and the SDK is built from `sdks/java` as an included build. From the repo root:

```sh
cd demos/java
./gradlew -q run --console=plain   # interactive: type your name, then y or n
```

Without typing:

```sh
HITLP_DEMO_ANSWERS=Ada,y ./gradlew -q run   # approved: the greeting is deployed
HITLP_DEMO_ANSWERS=Ada,n ./gradlew -q run   # rejected: nothing is deployed
./gradlew test                              # smoke tests of both paths
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

- [src/main/java/hello/Hello.java](src/main/java/hello/Hello.java): the agent.
- [src/main/java/hello/TerminalHuman.java](src/main/java/hello/TerminalHuman.java): the demo-only transport that plays the human at the terminal.
- [src/test/java/hello/HelloTest.java](src/test/java/hello/HelloTest.java): the smoke tests.
