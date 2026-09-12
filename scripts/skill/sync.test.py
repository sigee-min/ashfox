#!/usr/bin/env python3
"""Exercise the skill updater against a locally built release."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch


sys.dont_write_bytecode = True
repo_root = Path(__file__).resolve().parents[2]
release_root = Path(sys.argv[1]).resolve() / "skills" / "ashfox"
module_path = repo_root / "skills" / "ashfox" / "scripts" / "sync.py"
spec = importlib.util.spec_from_file_location("ashfox_skill_sync", module_path)
if spec is None or spec.loader is None:
    raise RuntimeError("Could not load the ashfox skill sync module.")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

descriptor_bytes = (release_root / "latest.json").read_bytes()
release, entries = sync.parse_descriptor(descriptor_bytes)
assert release

remote_files = {
    entry["url"]: (
        release_root / "files" / str(entry["path"])
    ).read_bytes()
    for entry in entries
}
remote_files[sync.DESCRIPTOR_URL] = descriptor_bytes
fetches: list[str] = []


def local_fetch(url: str, limit: int) -> bytes:
    fetches.append(url)
    data = remote_files[url]
    if len(data) > limit:
        raise sync.SyncError("fixture exceeds limit")
    return data


sync.fetch = local_fetch
downloaded = sync.download_release(entries)


def cli(root: Path, *arguments: str) -> int:
    """Exercise the real argument parser and entrypoint with isolated install roots."""
    with patch.object(sync, "__file__", str(root / "scripts" / "sync.py")), \
            patch.object(sys, "argv", ["sync.py", *arguments]):
        return sync.main()


with tempfile.TemporaryDirectory(prefix="ashfox-skill-cli-") as directory:
    installed = Path(directory)
    for relative in sync.CORE_PATHS:
        target = installed / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"outdated")
    before = {relative: (installed / relative).read_bytes() for relative in sync.CORE_PATHS}
    fetches.clear()
    assert cli(installed) == 2
    assert fetches == [sync.DESCRIPTOR_URL], "default check must not fetch release files"
    assert {relative: (installed / relative).read_bytes() for relative in sync.CORE_PATHS} == before
    assert not (installed / "agents").exists()
    assert cli(installed, "--install") == 0
    for relative in sync.CORE_PATHS:
        assert (installed / relative).read_bytes() == downloaded[relative]
    fetches.clear()
    assert cli(installed) == 0
    assert fetches == [sync.DESCRIPTOR_URL]

for git_is_file in [False, True]:
    with tempfile.TemporaryDirectory(prefix="ashfox-skill-checkout-") as directory:
        checkout = Path(directory)
        git = checkout / ".git"
        if git_is_file:
            git.write_text("gitdir: /unrelated/worktree")
        else:
            git.mkdir()
        root = checkout / "skills" / "ashfox"
        root.mkdir(parents=True)
        fetches.clear()
        try:
            cli(root, "--install")
        except sync.SyncError:
            pass
        else:
            raise AssertionError("Repository source installation was accepted.")
        assert fetches == [], "checkout rejection must precede all network access"
        assert list(root.iterdir()) == [], "checkout rejection must precede writes"
        try:
            sync.apply_release(root, downloaded)
        except sync.SyncError:
            pass
        else:
            raise AssertionError("Direct release application bypassed checkout protection.")

with tempfile.TemporaryDirectory(prefix="ashfox-skill-sync-") as directory:
    installed = Path(directory)
    for relative in sync.ALLOWED_PATHS:
        target = installed / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"outdated")
    sync.apply_release(installed, downloaded)
    for relative in sync.ALLOWED_PATHS:
        assert (installed / relative).read_bytes() == downloaded[relative]

with tempfile.TemporaryDirectory(prefix="ashfox-portable-skill-sync-") as directory:
    portable = Path(directory)
    for relative in sync.CORE_PATHS:
        target = portable / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"outdated")
    active_paths = sync.installed_paths(portable)
    assert active_paths == sync.CORE_PATHS
    portable_download = sync.download_release(entries, active_paths)
    sync.apply_release(portable, portable_download)
    assert not (portable / "agents" / "openai.yaml").exists()
    for relative in sync.CORE_PATHS:
        assert (portable / relative).read_bytes() == portable_download[relative]

tampered = json.loads(descriptor_bytes)
tampered["files"][0]["sha256"] = "0" * 64
try:
    sync.download_release(tampered["files"])
except sync.SyncError:
    pass
else:
    raise AssertionError("A tampered release was accepted.")

with tempfile.TemporaryDirectory(prefix="ashfox-skill-integrity-") as directory:
    installed = Path(directory)
    for relative in sync.CORE_PATHS:
        target = installed / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"unchanged")
    corrupted = json.loads(descriptor_bytes)
    for entry in corrupted["files"]:
        if entry["path"] == "SKILL.md":
            entry["sha256"] = "0" * 64
    with patch.dict(remote_files, {sync.DESCRIPTOR_URL: json.dumps(corrupted).encode()}):
        try:
            cli(installed, "--install")
        except sync.SyncError:
            pass
        else:
            raise AssertionError("CLI installed an integrity-failing release.")
    for relative in sync.CORE_PATHS:
        assert (installed / relative).read_bytes() == b"unchanged"

with tempfile.TemporaryDirectory(prefix="ashfox-skill-rollback-") as directory:
    installed = Path(directory)
    previous = {}
    for relative in sync.ALLOWED_PATHS:
        target = installed / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        previous[relative] = ("before:" + relative).encode()
        target.write_bytes(previous[relative])
    original_write = sync.atomic_write
    writes = 0

    def fail_second_write(target: Path, data: bytes) -> None:
        global writes
        writes += 1
        if writes == 2:
            raise OSError("simulated interrupted installation")
        original_write(target, data)

    with patch.object(sync, "atomic_write", fail_second_write):
        try:
            cli(installed, "--install")
        except sync.SyncError:
            pass
        else:
            raise AssertionError("Partial installation was reported successful.")
    assert writes > 2, "rollback must restore the already replaced file"
    for relative, data in previous.items():
        assert (installed / relative).read_bytes() == data

assert sync.trusted_url("https://ashfox.io/skills/ashfox/latest.json")
for url in ["http://ashfox.io/x", "https://ashfox.io.evil/x", "https://other.test/x"]:
    assert not sync.trusted_url(url)

print("ashfox skill sync simulation ok")

for field, replacement in [("schemaVersion", 1), ("documentationUrl", "https://example.com/docs/"), ("workbenchUrl", "https://ashfox.io/workbench/")]:
    retired = json.loads(descriptor_bytes)
    retired[field] = replacement
    try:
        sync.parse_descriptor(json.dumps(retired).encode())
        raise AssertionError(f"Accepted retired or invalid descriptor: {field}")
    except sync.SyncError:
        pass
