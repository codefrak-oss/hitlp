# HITLP hello world: TypeScript

A HITLP (human-in-the-loop-protocol) agent on the TypeScript SDK, [`@codefrak/hitlp`](../../sdks/typescript/README.md). See [the demos index](../README.md) for what it does.

Needs Node 20 or later. From the repo root:

```sh
cd demos/typescript
npm run sdk      # install and build the SDK in sdks/typescript (once)
npm install
npm start        # interactive: type your name, then y or n
```

Without typing:

```sh
HITLP_DEMO_ANSWERS=Ada,y npm start   # approved: the greeting is deployed
HITLP_DEMO_ANSWERS=Ada,n npm start   # rejected: nothing is deployed
npm test                             # smoke tests of both paths
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

- [src/hello.ts](src/hello.ts): the agent.
- [src/terminal-human.ts](src/terminal-human.ts): the demo-only transport that plays the human at the terminal.
