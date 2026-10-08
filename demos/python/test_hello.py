"""Smoke tests: run the demo with scripted answers. Run with pytest."""

from pathlib import Path

from hello import hello
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
