"""
Tier 0 Model Provisioner for Alpha Engine (news_event_correlator.py).

Downloads the INT8-quantized FinBERT ONNX classifier (ProsusAI/finbert exported by
Xenova/finbert) from a *pinned* Hugging Face revision and verifies every artifact
against pinned digests before atomically installing it.

Properties:
  - Deterministic: immutable git revision + pinned digests (no "latest" drift).
  - Idempotent: files already present with a matching digest are skipped.
  - Atomic: each file streams to '<name>.part' and is os.replace()'d only after
    verification, so a crash never leaves a truncated model behind.
  - Zero extra dependencies: stdlib urllib + hashlib only.

Usage:
  python provision_tier0_model.py                 # installs into ./models/finbert-int8
  python provision_tier0_model.py --dest /opt/m   # custom directory
  python provision_tier0_model.py --verify-only   # exit 1 if artifacts are missing/corrupt

The runtime loader honours ALPHA_TIER0_MODEL_DIR to point at a custom directory.
"""

import argparse
import hashlib
import json
import os
import sys
import urllib.request
from typing import Dict, List

REPO_ID = "Xenova/finbert"
BASE_MODEL = "ProsusAI/finbert"
REVISION = "8f269abebfdd9009d7d9b5e96af7e5c6bfe50b20"

DEFAULT_DEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "tier0-encoder")

# Digests sourced from the Hugging Face tree API at REVISION.
#   sha256        -> Git LFS object id (content SHA256)
#   git_blob_sha1 -> git blob id: sha1(b"blob <size>\0" + content)
ARTIFACTS: List[Dict] = [
    {
        "remote": "onnx/model_int8.onnx",
        "local": "model_int8.onnx",
        "size": 110248164,
        "algo": "sha256",
        "digest": "9b433bc285be993b172da20ca2436ea8fa5c803af0ceda0866273bf0df3e5034",
    },
    {
        "remote": "tokenizer.json",
        "local": "tokenizer.json",
        "size": 711396,
        "algo": "git_blob_sha1",
        "digest": "688882a79f44442ddc1f60d70334a7ff5df0fb47",
    },
    {
        "remote": "config.json",
        "local": "config.json",
        "size": 807,
        "algo": "git_blob_sha1",
        "digest": "03a8cbf103c162c52e162efca395d5dc636e1d56",
    },
]

_CHUNK = 1 << 20


def _new_hasher(algo: str, size: int):
    if algo == "sha256":
        return hashlib.sha256()
    if algo == "git_blob_sha1":
        h = hashlib.sha1()
        h.update(f"blob {size}\0".encode("ascii"))
        return h
    raise ValueError(f"Unsupported digest algorithm: {algo}")


def _file_matches(path: str, spec: Dict) -> bool:
    if not os.path.isfile(path) or os.path.getsize(path) != spec["size"]:
        return False
    h = _new_hasher(spec["algo"], spec["size"])
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest() == spec["digest"]


def _download_verified(spec: Dict, dest_dir: str, timeout: float) -> None:
    url = f"https://huggingface.co/{REPO_ID}/resolve/{REVISION}/{spec['remote']}"
    final_path = os.path.join(dest_dir, spec["local"])
    part_path = final_path + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": "alpha-engine-tier0-provisioner/1.0"})
    h = _new_hasher(spec["algo"], spec["size"])
    written = 0
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(part_path, "wb") as out:
            for chunk in iter(lambda: resp.read(_CHUNK), b""):
                out.write(chunk)
                h.update(chunk)
                written += len(chunk)
            out.flush()
            os.fsync(out.fileno())
        if written != spec["size"]:
            raise IOError(f"{spec['local']}: size mismatch (got {written}, expected {spec['size']})")
        if h.hexdigest() != spec["digest"]:
            raise IOError(f"{spec['local']}: {spec['algo']} mismatch (got {h.hexdigest()}, expected {spec['digest']})")
        os.replace(part_path, final_path)
    finally:
        if os.path.exists(part_path):
            os.remove(part_path)


def provision(dest_dir: str = DEFAULT_DEST, timeout: float = 120.0, verify_only: bool = False) -> bool:
    os.makedirs(dest_dir, exist_ok=True)
    all_ok = True
    legacy_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "finbert-int8")

    for spec in ARTIFACTS:
        path = os.path.join(dest_dir, spec["local"])
        if not os.path.isfile(path) and os.path.isdir(legacy_dir):
            legacy_path = os.path.join(legacy_dir, spec["local"])
            if os.path.isfile(legacy_path) and _file_matches(legacy_path, spec):
                import shutil
                shutil.copy2(legacy_path, path)
                print(f"[tier0] MIGRATED {spec['local']} from legacy directory ({spec['size']:,} bytes)")

        if _file_matches(path, spec):
            print(f"[tier0] OK      {spec['local']} ({spec['size']:,} bytes, {spec['algo']} verified)")
            continue
        if verify_only:
            print(f"[tier0] MISSING {spec['local']} (absent or digest mismatch)")
            all_ok = False
            continue
        print(f"[tier0] FETCH   {spec['local']} <- {REPO_ID}@{REVISION[:10]}")
        _download_verified(spec, dest_dir, timeout)
        print(f"[tier0] OK      {spec['local']} ({spec['size']:,} bytes, {spec['algo']} verified)")

    if all_ok:
        manifest = {
            "repo_id": REPO_ID,
            "base_model": BASE_MODEL,
            "revision": REVISION,
            "artifacts": {a["local"]: {"size": a["size"], a["algo"]: a["digest"]} for a in ARTIFACTS},
        }
        tmp = os.path.join(dest_dir, "manifest.json.part")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2)
        os.replace(tmp, os.path.join(dest_dir, "manifest.json"))
    return all_ok


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision the Alpha Engine Tier 0 INT8 FinBERT ONNX model.")
    parser.add_argument("--dest", default=os.environ.get("ALPHA_TIER0_MODEL_DIR", DEFAULT_DEST))
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    ok = provision(args.dest, args.timeout, args.verify_only)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
