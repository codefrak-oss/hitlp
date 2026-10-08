"""Smoke tests: run the demo with scripted answers. Run with pytest."""

import asyncio
import http.cookiejar
import importlib.util
import json
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

from hello import hello, hello_server
from terminal_human import scripted_prompt


def run(answers, tmp_path: Path):
    lines: list[str] = []
    cp = tmp_path / "cp.json"
    result = hello(scripted_prompt(answers, lines.append), log=lines.append, checkpoint_file=str(cp))
    return result, lines, cp


def test_greets_and_deploys_once_approved(tmp_path):
    result, lines, cp = run(["Ada", "y"], tmp_path)
    assert (result.name, result.deployed) == ("Ada", True)
    assert any("Hello, Ada!" in line for line in lines)
    assert not cp.exists()


def test_does_not_deploy_when_rejected(tmp_path):
    result, lines, _ = run(["Ada", "n"], tmp_path)
    assert (result.name, result.deployed) == ("Ada", False)
    assert any("Not approved (rejected)" in line for line in lines)


# Real-server mode: runs the demo against server/ (spawned from its build) and
# plays the human on the decision page. Skipped without node, the built server
# or hitlp[mcp].


MAIN = Path(__file__).resolve().parents[2] / "server" / "dist" / "src" / "main.js"
needs_server = pytest.mark.skipif(
    not (shutil.which("node") and MAIN.exists() and importlib.util.find_spec("fastmcp")),
    reason="needs node, a built server/ and hitlp[mcp]",
)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server(tmp_path):
    approvers = tmp_path / "approvers.json"
    approvers.write_text(json.dumps([{"credential": "pw-demo", "id": "h-demo", "roles": [], "capabilities": []}]))
    page_port = _free_port()
    proc = subprocess.Popen(
        ["node", str(MAIN), "--db", str(tmp_path / "hitlp.db"), "--http-port", "0", "--approvers", str(approvers), "--page-port", str(page_port)],
        stderr=subprocess.PIPE,
        text=True,
    )
    mcp = None
    while mcp is None:
        line = proc.stderr.readline()
        if not line:
            raise RuntimeError("server exited")
        m = re.search(r"MCP on (\S+)", line)
        mcp = m and m.group(1)
    threading.Thread(target=proc.stderr.read, daemon=True).start()
    yield mcp, f"http://127.0.0.1:{page_port}"
    proc.kill()


def _human(page: str, lines: list[str], answers: list[dict[str, str]]) -> None:
    """Logs in, then answers each task the agent says it waits on."""
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.open(f"{page}/login", urllib.parse.urlencode({"credential": "pw-demo", "next": ""}).encode())
    seen = 0
    for fields in answers:
        task_id = None
        while task_id is None:
            for line in lines[seen:]:
                seen += 1
                m = re.search(r"Task (\S+) waits for a human", line)
                if m:
                    task_id = m.group(1)
                    break
            else:
                time.sleep(0.02)
        url = f"{page}/decide/{task_id}"
        html = opener.open(url).read().decode()
        hidden = {k: v for k, v in re.findall(r'name="(csrf|digest)" value="([^"]*)"', html)}
        assert opener.open(url, urllib.parse.urlencode({**hidden, **fields}).encode()).status == 200


def _run_server(server, tmp_path, answers):
    mcp, page = server
    lines: list[str] = []
    human = threading.Thread(target=_human, args=(page, lines, answers), daemon=True)
    human.start()
    result = asyncio.run(hello_server(mcp, "local", log=lines.append, checkpoint_file=str(tmp_path / "cp.json")))
    human.join(5)
    return result, lines


@needs_server
def test_server_mode_answers_and_approves_on_the_page(server, tmp_path):
    result, lines = _run_server(server, tmp_path, [{"answer": "Ada"}, {"decision": "approve"}])
    assert (result.name, result.deployed) == ("Ada", True)
    assert any("Approved by h-demo" in line for line in lines)


@needs_server
def test_server_mode_does_not_deploy_when_rejected(server, tmp_path):
    result, lines = _run_server(server, tmp_path, [{"answer": "Ada"}, {"decision": "reject"}])
    assert (result.name, result.deployed) == ("Ada", False)
    assert any("Not approved (rejected)" in line for line in lines)
