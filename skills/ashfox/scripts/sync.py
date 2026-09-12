#!/usr/bin/env python3
"""Check ashfox skill updates; install only with explicit --install."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Final
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ORIGIN: Final = "https://ashfox.io"
DESCRIPTOR_URL: Final = f"{ORIGIN}/skills/ashfox/latest.json"
CORE_PATHS: Final = frozenset({
    "SKILL.md",
    "scripts/sync.py",
})
ADAPTER_PATHS: Final = frozenset({"agents/openai.yaml"})
ALLOWED_PATHS: Final = CORE_PATHS | ADAPTER_PATHS
MAX_DESCRIPTOR_BYTES: Final = 64 * 1024
MAX_FILE_BYTES: Final = 256 * 1024
TIMEOUT_SECONDS: Final = 12


class SyncError(RuntimeError):
    """Raised when the remote release cannot be trusted or applied."""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def trusted_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "https" and parsed.netloc == "ashfox.io"


def fetch(url: str, limit: int) -> bytes:
    if not trusted_url(url):
        raise SyncError(f"Refusing untrusted URL: {url}")
    request = Request(
        url,
        headers={
            "Accept": "application/json, text/plain, */*",
            "Cache-Control": "no-cache",
            "User-Agent": "ashfox-skill-sync/2",
        },
    )
    with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        if not trusted_url(response.geturl()):
            raise SyncError(f"Refusing redirected URL: {response.geturl()}")
        if response.status != 200:
            raise SyncError(f"Unexpected HTTP status {response.status}: {url}")
        data = response.read(limit + 1)
    if len(data) > limit:
        raise SyncError(f"Remote file exceeds {limit} bytes: {url}")
    return data


def parse_descriptor(data: bytes) -> tuple[str, list[dict[str, object]]]:
    try:
        value = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SyncError("Release descriptor is not valid UTF-8 JSON.") from error
    if not isinstance(value, dict):
        raise SyncError("Release descriptor must be an object.")
    if value.get("schemaVersion") != 2 or value.get("name") != "ashfox":
        raise SyncError("Release descriptor identity is invalid.")
    if value.get("documentationUrl") != f"{ORIGIN}/docs/guides/agent-workflow/":
        raise SyncError("Release documentation URL is invalid.")
    if "manifestUrl" in value or "workbenchUrl" in value:
        raise SyncError("Retired browser authoring descriptor fields are forbidden.")
    release = value.get("release")
    files = value.get("files")
    if not isinstance(release, str) or not release:
        raise SyncError("Release descriptor has no release identifier.")
    if not isinstance(files, list) or len(files) != len(ALLOWED_PATHS):
        raise SyncError("Release descriptor has an invalid file set.")
    paths: list[str] = []
    for entry in files:
        if not isinstance(entry, dict):
            raise SyncError("Release descriptor contains a non-file entry.")
        path = entry.get("path")
        if not isinstance(path, str) or path not in ALLOWED_PATHS:
            raise SyncError(f"Release descriptor path is invalid: {path!r}")
        expected_role = "core" if path in CORE_PATHS else "adapter"
        if entry.get("role") != expected_role:
            raise SyncError(f"Release descriptor role is invalid: {path!r}")
        paths.append(path)
    if frozenset(paths) != ALLOWED_PATHS or len(set(paths)) != len(paths):
        raise SyncError("Release descriptor file paths are not canonical.")
    return release, files


def download_release(
    entries: list[dict[str, object]],
    selected_paths: frozenset[str] = ALLOWED_PATHS,
) -> dict[str, bytes]:
    downloaded: dict[str, bytes] = {}
    for entry in entries:
        path = entry.get("path")
        if path not in selected_paths:
            continue
        url = entry.get("url")
        expected_hash = entry.get("sha256")
        expected_bytes = entry.get("bytes")
        canonical_url = (
            f"{ORIGIN}/skills/ashfox/files/{path}"
            if isinstance(path, str)
            else None
        )
        if (
            not isinstance(path, str)
            or path not in ALLOWED_PATHS
            or not isinstance(url, str)
            or url != canonical_url
            or not isinstance(expected_hash, str)
            or len(expected_hash) != 64
            or any(character not in "0123456789abcdef" for character in expected_hash)
            or type(expected_bytes) is not int
            or expected_bytes < 1
            or expected_bytes > MAX_FILE_BYTES
        ):
            raise SyncError(f"Invalid release entry: {path!r}")
        data = fetch(url, MAX_FILE_BYTES)
        if len(data) != expected_bytes or sha256(data) != expected_hash:
            raise SyncError(f"Integrity check failed: {path}")
        downloaded[path] = data
    skill = downloaded["SKILL.md"]
    if not skill.startswith(b"---\nname: ashfox\n"):
        raise SyncError("Downloaded SKILL.md has an invalid identity.")
    return downloaded


def installed_paths(root: Path) -> frozenset[str]:
    return CORE_PATHS | frozenset(
        path
        for path in ADAPTER_PATHS
        if skill_target(root, path).is_file()
    )


def current_hash(root: Path, relative_path: str) -> str | None:
    target = skill_target(root, relative_path)
    return sha256(target.read_bytes()) if target.is_file() else None


def skill_target(root: Path, relative_path: str) -> Path:
    if relative_path not in ALLOWED_PATHS:
        raise SyncError(f"Refusing non-canonical skill path: {relative_path}")
    canonical_root = root.resolve()
    target = root / relative_path
    canonical_parent = target.parent.resolve()
    try:
        canonical_parent.relative_to(canonical_root)
    except ValueError as error:
        raise SyncError(
            f"Refusing a skill path outside the installed folder: {relative_path}"
        ) from error
    return target


def atomic_write(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        prefix=f".{target.name}.",
        dir=target.parent,
    )
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o755 if target.name == "sync.py" else 0o644)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def apply_release(root: Path, downloaded: dict[str, bytes]) -> None:
    require_install_directory(root)
    paths = frozenset(downloaded)
    if not CORE_PATHS.issubset(paths) or not paths.issubset(ALLOWED_PATHS):
        raise SyncError("Downloaded release does not contain canonical core files.")
    previous = {
        path: (
            skill_target(root, path).read_bytes()
            if skill_target(root, path).is_file()
            else None
        )
        for path in paths
    }
    replaced: list[str] = []
    try:
        for path in sorted(
            paths,
            key=lambda item: (item == "scripts/sync.py", item),
        ):
            atomic_write(skill_target(root, path), downloaded[path])
            replaced.append(path)
    except OSError as error:
        for path in reversed(replaced):
            before = previous[path]
            target = skill_target(root, path)
            if before is None:
                target.unlink(missing_ok=True)
            else:
                atomic_write(target, before)
        raise SyncError(
            "The installed skill is read-only or could not be updated."
        ) from error


def require_install_directory(root: Path) -> None:
    canonical = root.resolve()
    if any((ancestor / ".git").exists() for ancestor in (canonical, *canonical.parents)):
        raise SyncError("Refusing to overwrite a skill inside a repository checkout.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check for verified ashfox skill updates without writing files."
    )
    parser.add_argument(
        "--install",
        action="store_true",
        help="explicitly install an update into a non-repository skill folder",
    )
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if arguments.install:
        require_install_directory(root)
    descriptor = fetch(DESCRIPTOR_URL, MAX_DESCRIPTOR_BYTES)
    release, entries = parse_descriptor(descriptor)
    expected = {
        str(entry["path"]): str(entry["sha256"])
        for entry in entries
    }
    active_paths = installed_paths(root)
    changed = [
        path
        for path in sorted(active_paths)
        if current_hash(root, path) != expected[path]
    ]
    if not changed:
        print(f"ashfox skill {release} is current")
        return 0
    if not arguments.install:
        print(f"ashfox skill {release} update available: {', '.join(changed)}")
        return 2
    downloaded = download_release(entries, active_paths)
    apply_release(root, downloaded)
    print(f"ashfox skill updated to {release}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SyncError as error:
        print(f"ashfox skill sync failed: {error}")
        raise SystemExit(1)
