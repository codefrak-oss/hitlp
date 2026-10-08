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

## Against a real server

Set `HITLP_DEMO_SERVER` to the MCP URL of [server/](../../server/README.md) and the demo talks to it through the SDK's `McpTaskTransport` instead of the terminal human; `HITLP_DEMO_TOKEN` is its bearer token (default `local`). The human answers on the server's decision page. In one terminal, from the repo root:

```sh
cd server && npm ci && npm run build
echo '[{"credential":"pw-demo","id":"h-demo","roles":[],"capabilities":[]}]' > approvers.json
node dist/src/main.js --db demo.db --http-port 3000 --approvers approvers.json
```

In another:

```sh
cd demos/python
pip install -e '../../sdks/python[mcp]'
HITLP_DEMO_SERVER=http://127.0.0.1:3000/mcp python hello.py
```

The demo prints `Task <id> waits for a human` for each request, with the decision page URL for the Approve; the server logs the page URL for the Ask (`hitlp: answer at ...`). Open it, sign in with `pw-demo`, and answer.

With node, `server/` built and `hitlp[mcp]` installed, `pytest test_hello.py` also runs the demo against it and plays the human on the page.

- [hello.py](hello.py): the agent.
- [terminal_human.py](terminal_human.py): the demo-only transport that plays the human at the terminal.
