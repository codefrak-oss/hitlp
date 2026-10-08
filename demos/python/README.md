# HITLP hello world: Python

A HITLP (human-in-the-loop-protocol) agent on the Python SDK, [`hitlp`](../../sdks/python/README.md). See [the demos index](../README.md) for what it does.

Needs Python 3.10 or later. From the repo root:

```sh
cd demos/python
python -m venv .venv && . .venv/bin/activate
pip install -e ../../sdks/python pytest
python hello.py      # interactive: type your name, then y or n
```

Without typing:

```sh
HITLP_DEMO_ANSWERS=Ada,y python hello.py   # approved: the greeting is deployed
HITLP_DEMO_ANSWERS=Ada,n python hello.py   # rejected: nothing is deployed
pytest test_hello.py                       # smoke tests of both paths
```

A run looks like this:

```
[agent] Asking the human for their name (human.ask) ...
[human] What is your name? Ada
[agent] Hello, Ada!
[agent] Requesting approval for deploy.greeting (human.approve) ...
[agent] Checkpointed task task-2; resuming from the checkpoint.
[human] Approve "deploy.greeting" {"greeting": "Hello, Ada!", "target": "hello-world"}? [y/N] y
[agent] Approved by terminal-human. Deploying "Hello, Ada!" ... done.
```

- [hello.py](hello.py): the agent.
- [terminal_human.py](terminal_human.py): the demo-only transport that plays the human at the terminal.
